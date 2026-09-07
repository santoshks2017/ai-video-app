import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { isPromptOnly, estimateCost, type Brief, type PromptPart } from '@ava/shared';
import { loadConfig } from './config.js';
import { generateClip, downloadFile, OmniFlashError, type OmniRef } from './omniFlash.js';
import {
  saveJob,
  updateJob,
  getJob,
  uploadClip,
  streamClip,
  putRef,
  readObject,
  type JobRecord,
  type JobClip,
} from './store.js';
import { scrapeModel, getCarModel } from './scraper.js';
import { concatClips, lastFrame } from './concat.js';
import { authEnabled, bearer, checkPassword, issueToken, verifyToken } from './auth.js';
import { listAll, getOne, upsert, patch, remove, type Collection } from './library.js';
import { syncCarModel } from './carSync.js';
import { importPlace, PlacesError } from './places.js';
import { putCredentialKey, getCredentialKey, deleteCredentialKey } from './credentials.js';

const config = loadConfig();
const app = Fastify({ logger: true, bodyLimit: 15 * 1024 * 1024 });

app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('access-control-allow-origin', config.allowOrigin);
  reply.header('access-control-allow-headers', 'content-type, authorization');
  reply.header('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  return payload;
});
app.options('/*', async (_req, reply) => reply.code(204).send());

app.get('/api/health', async () => ({
  ok: true,
  omniFlashKeyPresent: Boolean(config.googleApiKey),
  model: config.omniFlashModel,
}));

/* ============================ auth (shared password) ============================ */

const OPEN_PATHS = new Set(['/api/health', '/api/session']);

app.addHook('preHandler', async (req, reply) => {
  if (req.method === 'OPTIONS') return;
  const url = (req.raw.url ?? '').split('?')[0] ?? '';
  if (!url.startsWith('/api/')) return;
  if (OPEN_PATHS.has(url)) return;
  // Clips and reference images are fetched by <video>/<img>, which cannot send
  // an Authorization header. They are unguessable UUID paths.
  if (url.startsWith('/api/clips/') || url.startsWith('/api/refs/')) return;
  if (!verifyToken(bearer(req.headers.authorization))) {
    return reply.code(401).send({ code: 'unauthorized', message: 'Sign in with the team password.' });
  }
});

app.get('/api/session', async () => ({ authEnabled: authEnabled() }));

app.post<{ Body: { password?: string } }>('/api/session', async (req, reply) => {
  if (!authEnabled()) return { token: 'open', authEnabled: false };
  if (!checkPassword(req.body?.password ?? '')) {
    return reply.code(401).send({ code: 'bad-password', message: 'Wrong password.' });
  }
  return { token: issueToken(), authEnabled: true };
});

/* ============================ library CRUD ============================ */

const COLLECTIONS: Collection[] = ['actors', 'cars', 'clients', 'instructions', 'projects', 'credentials', 'models'];

for (const name of COLLECTIONS) {
  app.get(`/api/${name}`, async () => ({ items: await listAll(name) }));

  app.get<{ Params: { id: string } }>(`/api/${name}/:id`, async (req, reply) => {
    const doc = await getOne(name, req.params.id);
    if (!doc) return reply.code(404).send({ code: 'not-found', message: `No such ${name} record` });
    return doc;
  });

  app.post<{ Body: Record<string, unknown> }>(`/api/${name}`, async (req, reply) => {
    if (!req.body || typeof req.body !== 'object') {
      return reply.code(400).send({ code: 'bad-request', message: 'Body required' });
    }
    return await upsert(name, req.body);
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    `/api/${name}/:id`,
    async (req, reply) => {
      const existing = await getOne(name, req.params.id);
      if (!existing) return reply.code(404).send({ code: 'not-found', message: 'No such record' });
      await patch(name, req.params.id, req.body ?? {});
      return await getOne(name, req.params.id);
    },
  );

  app.delete<{ Params: { id: string } }>(`/api/${name}/:id`, async (req) => {
    await remove(name, req.params.id);
    return { ok: true };
  });
}

/* ---- provider API keys (write-only from the client) ---- */

app.post<{ Params: { id: string }; Body: { key?: string } }>(
  '/api/credentials/:id/key',
  async (req, reply) => {
    const key = (req.body?.key ?? '').trim();
    if (!key) return reply.code(400).send({ code: 'bad-request', message: 'key required' });
    const cred = await getOne<{ id: string }>('credentials', req.params.id);
    if (!cred) return reply.code(404).send({ code: 'not-found', message: 'No such credential' });
    await putCredentialKey(req.params.id, key);
    await patch('credentials', req.params.id, { hasKey: true });
    return { ok: true, hasKey: true };
  },
);

app.delete<{ Params: { id: string } }>('/api/credentials/:id/key', async (req) => {
  await deleteCredentialKey(req.params.id);
  await patch('credentials', req.params.id, { hasKey: false });
  return { ok: true, hasKey: false };
});

/** Seed the built-in Gemini credential + Omni Flash model on first run. */
app.post('/api/models/seed', async () => {
  const existing = await listAll<{ id: string }>('models');
  if (existing.length) return { seeded: false, models: existing.length };
  const cred = await upsert('credentials', {
    name: 'Gemini (deploy key)',
    provider: 'google-gemini',
    hasKey: Boolean(config.googleApiKey),
    usesEnvKey: true,
    enabled: true,
    notes: 'Uses the GOOGLE_API_KEY set on the Cloud Run service.',
  });
  const model = await upsert('models', {
    credentialId: cred.id,
    name: 'Gemini Omni Flash',
    modelId: config.omniFlashModel,
    minClipSec: 3,
    maxClipSec: 10,
    resolutions: ['720p'],
    aspects: ['9:16', '16:9'],
    supportsImageToVideo: true,
    supportsReferenceImages: true,
    maxReferenceImages: 2,
    usdPerSecond: config.usdPerSecond,
    enabled: true,
    isDefault: true,
  });
  return { seeded: true, credential: cred, model };
});

/* ---- car library sync: Brand → Model → Variant → Colour ---- */
app.post<{ Body: { query?: string; refresh?: boolean } }>('/api/cars/sync', async (req, reply) => {
  const query = req.body?.query?.trim();
  if (!query) return reply.code(400).send({ code: 'bad-request', message: 'query required (e.g. "Hyundai Creta")' });
  try {
    const profile = await syncCarModel(query);
    const existing = await getOne<{ createdAt?: number }>('cars', profile.id);
    const saved = await upsert('cars', { ...profile, createdAt: existing?.createdAt ?? profile.createdAt });
    return saved;
  } catch (e) {
    return reply.code(502).send({ code: 'car-sync-failed', message: (e as Error).message });
  }
});

/* ---- client import from a Google Business Profile link ---- */
app.post<{ Body: { url?: string; query?: string } }>('/api/clients/gmb', async (req, reply) => {
  try {
    const out = await importPlace({ url: req.body?.url, query: req.body?.query, maxPhotos: 4 });
    return out;
  } catch (e) {
    const err = e as PlacesError;
    return reply
      .code(err.status ?? 502)
      .send({ code: err.code ?? 'gmb-import-failed', message: err.message });
  }
});

/** Resolution for v1: Omni Flash is used at 720p (PRD P0.3 note). */
const RES = '720p' as const;

interface GenerateBody {
  brief: Brief;
  parts: PromptPart[];
  confirmedCostInr?: number;
  /** VideoModelProfile id. Falls back to the default model, then the deploy key. */
  modelId?: string;
}

interface ResolvedModel {
  modelId: string;
  apiKey: string;
  maxReferenceImages: number;
  usdPerSecond: number;
  supportsImageToVideo: boolean;
  label: string;
}

/** Pick the model for this run and fetch the key it needs. */
async function resolveModel(requestedId?: string): Promise<ResolvedModel | { error: string; code: string }> {
  const models = await listAll<Record<string, any>>('models');
  const chosen =
    (requestedId && models.find((m) => m.id === requestedId)) ||
    models.find((m) => m.isDefault && m.enabled !== false) ||
    models.find((m) => m.enabled !== false);

  // Nothing configured yet — fall back to the deploy-time Gemini setup.
  if (!chosen) {
    if (!config.googleApiKey)
      return { code: 'omni-flash-not-configured', error: 'No model configured and GOOGLE_API_KEY is not set.' };
    return {
      modelId: config.omniFlashModel,
      apiKey: config.googleApiKey,
      maxReferenceImages: 2,
      usdPerSecond: config.usdPerSecond,
      supportsImageToVideo: true,
      label: config.omniFlashModel,
    };
  }

  const cred = await getOne<Record<string, any>>('credentials', chosen.credentialId);
  if (!cred) return { code: 'credential-missing', error: `Model "${chosen.name}" has no API credential.` };
  if (cred.provider !== 'google-gemini') {
    return {
      code: 'provider-not-implemented',
      error: `${cred.provider} is registered but its video adapter isn't implemented yet — only Google Gemini generates today.`,
    };
  }

  const apiKey = cred.usesEnvKey ? config.googleApiKey : await getCredentialKey(cred.id);
  if (!apiKey)
    return { code: 'credential-no-key', error: `No API key saved for "${cred.name}". Add one in APIs & models.` };

  return {
    modelId: chosen.modelId,
    apiKey,
    maxReferenceImages: Number(chosen.maxReferenceImages ?? 2),
    usdPerSecond: Number(chosen.usdPerSecond ?? config.usdPerSecond),
    supportsImageToVideo: chosen.supportsImageToVideo !== false,
    label: chosen.name ?? chosen.modelId,
  };
}

/**
 * P0.1 / P0.7 — generate the video by running the parts as a create-then-extend
 * chain on Omni Flash. Long-running (minutes): the Cloud Run request timeout is
 * raised in deploy config; progress is written to the Firestore job record so a
 * reload can recover via GET /api/generate/:jobId.
 */
app.post<{ Body: GenerateBody }>('/api/generate', async (req, reply) => {
  const { brief, parts, confirmedCostInr } = req.body ?? ({} as GenerateBody);
  if (!brief || !Array.isArray(parts) || parts.length === 0) {
    return reply.code(400).send({ code: 'bad-request', message: 'brief and parts are required' });
  }
  if (isPromptOnly(brief.categories)) {
    return reply
      .code(422)
      .send({ code: 'prompt-only', message: 'This brief includes a presenter category — it is prompt-only.' });
  }
  const picked = await resolveModel(req.body?.modelId);
  if ('error' in picked) {
    return reply.code(503).send({ code: picked.code, message: picked.error });
  }
  // Narrowing doesn't survive into the closures below, so bind it explicitly.
  const resolved: ResolvedModel = picked;

  const cost = estimateCost(brief, { usdPerSecond: resolved.usdPerSecond });
  if (cost.needsConfirmation && (confirmedCostInr ?? 0) < cost.inr) {
    return reply.code(428).send({
      code: 'cost-confirmation-required',
      message: `Estimated ₹${cost.inr} exceeds the ₹500 threshold — resubmit with confirmedCostInr.`,
      cost,
    });
  }

  const jobId = randomUUID();
  const now = Date.now();
  const clips: JobClip[] = parts.map((p) => ({
    partNum: p.partNum,
    totalParts: p.totalParts,
    seconds: p.duration,
    start: p.start,
    end: p.end,
    interactionId: '',
    storagePath: '',
    status: 'pending',
  }));
  const record: JobRecord = {
    jobId,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    categories: brief.categories,
    dealerName: brief.dealer.dealerName,
    aspect: brief.aspect,
    resolution: RES,
    totalSeconds: cost.totalSeconds,
    costInr: cost.inr,
    clips,
  };
  await saveJob(record).catch((e) => app.log.error(e, 'saveJob failed'));

  // Ground the model with any uploaded / scraped reference images (P0.4 / P0.2):
  // read the stored bytes and pass them inline as base64.
  const references: OmniRef[] = [];
  for (const a of brief.attachments ?? []) {
    if (!a.storagePath) continue;
    const obj = await readObject(a.storagePath).catch(() => null);
    if (!obj) continue;
    references.push({
      data: obj.bytes.toString('base64'),
      mimeType: obj.contentType || 'image/jpeg',
      kind: 'image',
    });
  }

  // No `extend` — each segment is an independent `create`, seeded with the
  // PREVIOUS segment's last frame as a reference image (+ any brief reference
  // images) so the presenter / car / setting stay identical across the cut.
  // All segments are ffmpeg-stitched into one final video.
  async function pull(clip: Awaited<ReturnType<typeof generateClip>>): Promise<Buffer> {
    if (clip.base64) return Buffer.from(clip.base64, 'base64');
    if (clip.fileId) return (await downloadFile(clip.fileId, resolved.apiKey)).bytes;
    throw new OmniFlashError('omni-flash-no-video', 'Clip had neither base64 nor a file id.');
  }

  try {
    const segmentBytes: Buffer[] = [];
    let prevBytes: Buffer | null = null;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isFirst = i === 0;

      const refs: OmniRef[] = [];
      let seededFromFrame = false;
      if (!isFirst && prevBytes && resolved.supportsImageToVideo) {
        const frame = await lastFrame(prevBytes);
        if (frame) {
          refs.push({ data: frame.toString('base64'), mimeType: 'image/jpeg', kind: 'image' });
          seededFromFrame = true;
        }
      }
      if (seededFromFrame) {
        // image_to_video caps the reference count (2 on Omni Flash): seed frame
        // + as many car references as the model allows.
        refs.push(...references.slice(0, Math.max(0, resolved.maxReferenceImages - 1)));
      } else {
        refs.push(...references); // part 1: all brief refs (reference_to_video)
      }

      const clip = await generateClip(
        {
          prompt: isFirst ? part.text : part.continuationText || part.text,
          aspect: brief.aspect,
          resolution: RES,
          references: refs.length ? refs : undefined,
          task: seededFromFrame
            ? 'image_to_video' // prev frame is frame 1 → continue the motion
            : refs.length
              ? 'reference_to_video'
              : 'text_to_video',
          model: resolved.modelId,
        },
        resolved.apiKey,
      );

      const bytes = await pull(clip);
      const storagePath = await uploadClip(jobId, part.partNum, bytes, clip.mimeType);
      clips[i] = { ...clips[i]!, interactionId: clip.interactionId, storagePath, status: 'done' };
      await updateJob(jobId, { clips });

      segmentBytes.push(bytes);
      prevBytes = bytes;
    }

    let finalStoragePath: string;
    if (segmentBytes.length <= 1) {
      finalStoragePath = clips[0]!.storagePath;
    } else {
      const finalBytes = await concatClips(segmentBytes);
      finalStoragePath = await uploadClip(jobId, 0, finalBytes, 'video/mp4'); // part 0 = final
    }

    await updateJob(jobId, { status: 'done', clips, finalStoragePath });
    return {
      jobId,
      status: 'done',
      cost,
      finalUrl: `/api/clips/${jobId}/final`,
      clips: clipsForClient(jobId, clips),
    };
  } catch (err) {
    const e = err as OmniFlashError;
    const failedIdx = clips.findIndex((c) => c.status === 'pending');
    if (failedIdx >= 0) clips[failedIdx] = { ...clips[failedIdx]!, status: 'failed', error: e.message };
    await updateJob(jobId, { status: 'failed', error: e.message, clips }).catch(() => {});
    // Salvage: if at least one run finished, stitch what we have so the user
    // still gets a (shorter) video plus the error.
    let finalUrl: string | undefined;
    try {
      const done = clips.filter((c) => c.status === 'done' && c.storagePath);
      if (done.length) {
        await updateJob(jobId, { finalStoragePath: done[done.length - 1]!.storagePath }).catch(() => {});
        finalUrl = `/api/clips/${jobId}/final`;
      }
    } catch {
      /* ignore */
    }
    return reply.code(e instanceof OmniFlashError ? e.status : 502).send({
      code: e.code ?? 'generate-failed',
      message: e.message,
      jobId,
      finalUrl,
      clips: clipsForClient(jobId, clips),
    });
  }
});

app.get<{ Params: { jobId: string } }>('/api/generate/:jobId', async (req, reply) => {
  const job = await getJob(req.params.jobId);
  if (!job) return reply.code(404).send({ code: 'not-found', message: 'No such job' });
  return {
    ...job,
    finalUrl: job.finalStoragePath ? `/api/clips/${job.jobId}/final` : undefined,
    clips: clipsForClient(job.jobId, job.clips),
  };
});

app.get<{ Params: { jobId: string; part: string } }>('/api/clips/:jobId/:part', async (req, reply) => {
  const job = await getJob(req.params.jobId);
  if (!job) return reply.code(404).send({ code: 'not-found', message: 'No such job' });
  const storagePath =
    req.params.part === 'final'
      ? job.finalStoragePath
      : job.clips.find((c) => String(c.partNum) === req.params.part)?.storagePath;
  if (!storagePath) return reply.code(404).send({ code: 'not-found', message: 'No such clip' });
  const s = await streamClip(storagePath);
  if (!s) return reply.code(404).send({ code: 'not-found', message: 'Clip missing from storage' });
  reply.header('content-type', s.contentType);
  reply.header('accept-ranges', 'bytes');
  if (s.size) reply.header('content-length', String(s.size));
  return reply.send(s.stream);
});

function clipsForClient(jobId: string, clips: JobClip[]) {
  // Omni Flash extend output is cumulative — the last successful clip is the
  // whole finished video.
  const lastDone = [...clips].reverse().find((c) => c.status === 'done');
  return clips.map((c) => ({
    partNum: c.partNum,
    totalParts: c.totalParts,
    seconds: c.seconds,
    start: c.start,
    end: c.end,
    status: c.status,
    error: c.error,
    isFinal: c === lastDone,
    url: c.status === 'done' ? `/api/clips/${jobId}/${c.partNum}` : null,
  }));
}

/**
 * P0.4 — upload a labelled reference image. Bytes go to Cloud Storage; the
 * brief carries the storagePath, which /api/generate reads back to ground the
 * model. Body: { filename, contentType, label, kind, dataBase64 }.
 */
app.post<{
  Body: { filename?: string; contentType?: string; label?: string; kind?: string; dataBase64?: string };
}>('/api/refs', async (req, reply) => {
  const b = req.body ?? {};
  if (!b.dataBase64 || !b.label?.trim()) {
    return reply.code(400).send({ code: 'bad-request', message: 'dataBase64 and label are required' });
  }
  const bytes = Buffer.from(b.dataBase64.replace(/^data:[^,]+,/, ''), 'base64');
  if (bytes.length > 8 * 1024 * 1024) {
    return reply.code(413).send({ code: 'too-large', message: 'Reference image exceeds 8MB.' });
  }
  const { refId, storagePath } = await putRef(
    b.filename || 'ref.jpg',
    b.contentType || 'image/jpeg',
    bytes,
  );
  return {
    refId,
    storagePath,
    filename: b.filename || `${refId}.jpg`,
    label: b.label.trim(),
    kind: b.kind || 'dealer',
  };
});

app.get<{ Params: { refId: string; name: string } }>('/api/refs/:refId/:name', async (req, reply) => {
  const obj = await readObject(`refs/${req.params.refId}/${req.params.name}`);
  if (!obj) return reply.code(404).send({ code: 'not-found', message: 'No such reference image' });
  reply.header('content-type', obj.contentType);
  reply.header('cache-control', 'public, max-age=86400');
  return reply.send(obj.bytes);
});

/**
 * P0.2 — scrape a current reference-image set for named car models from
 * cardekho.com and store them, so a model-specific brief isn't left to invent
 * an outdated design. Runs inline (small list); returns per-model results.
 */
app.post<{ Body: { models: string[] } }>('/api/scrape', async (req, reply) => {
  const models = (req.body?.models ?? []).filter((m) => m && m.trim()).slice(0, 3);
  if (!models.length) return reply.code(400).send({ code: 'bad-request', message: 'models[] required' });
  const results: unknown[] = [];
  for (const m of models) {
    try {
      results.push(withRefUrls(await scrapeModel(m)));
    } catch (e) {
      results.push({ input: m, status: 'failed', error: (e as Error).message });
    }
  }
  return { results };
});

app.get<{ Params: { key: string } }>('/api/car-models/:key', async (req, reply) => {
  const doc = await getCarModel(req.params.key);
  if (!doc) return reply.code(404).send({ code: 'not-found', message: 'Not scraped yet' });
  return withRefUrls(doc);
});

function withRefUrls<T extends { images: { storagePath: string }[] }>(doc: T) {
  return {
    ...doc,
    images: doc.images.map((im) => ({
      ...im,
      url: `/api/refs/${im.storagePath.split('/').slice(1).join('/')}`,
    })),
  };
}

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then((addr) => app.log.info(`api listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
