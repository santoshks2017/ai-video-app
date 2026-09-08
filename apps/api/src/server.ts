import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import {
  isPromptOnly,
  estimateCost,
  estimateSegmentsCost,
  applyFeedback,
  overlayCopy,
  type Brief,
  type PromptPart,
} from '@ava/shared';
import { loadConfig } from './config.js';
import { generateClip, downloadFile, OmniFlashError, type OmniRef } from './omniFlash.js';
import { generateSeedanceClip, testSeedanceKey, SeedanceError, type SeedanceRef } from './seedance.js';
import {
  saveJob,
  updateJob,
  getJob,
  uploadClip,
  streamClip,
  putRef,
  readObject,
  listJobsForProject,
  type JobRecord,
  type JobClip,
} from './store.js';
import { scrapeModel, getCarModel } from './scraper.js';
import { composeFinal, lastFrame, posterFrame, selfTest, type BrandOverlay } from './post.js';
import { authEnabled, bearer, checkPassword, issueToken, verifyToken } from './auth.js';
import { listAll, getOne, upsert, patch, remove, type Collection } from './library.js';
import {
  OMNI_FLASH_DEFAULTS,
  SEEDANCE_25_DEFAULTS,
  SEEDANCE_20_FAST_DEFAULTS,
  type ProviderKind,
} from '@ava/shared';
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

app.get<{ Querystring: { deep?: string } }>('/api/health', async (req) => ({
  ok: true,
  omniFlashKeyPresent: Boolean(config.googleApiKey),
  model: config.omniFlashModel,
  // ?deep=1 exercises ffmpeg + the SVG rasteriser used for the overlays.
  ...(req.query?.deep ? { post: await selfTest() } : {}),
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

/** Check a saved key without spending anything on a generation. */
app.post<{ Params: { id: string } }>('/api/credentials/:id/test', async (req, reply) => {
  const cred = await getOne<Record<string, any>>('credentials', req.params.id);
  if (!cred) return reply.code(404).send({ code: 'not-found', message: 'No such credential' });
  const apiKey = cred.usesEnvKey ? config.googleApiKey : await getCredentialKey(cred.id);
  if (!apiKey) return { ok: false, detail: 'No key saved for this connection yet.' };
  if (cred.provider === 'byteplus-ark') return await testSeedanceKey(apiKey);
  return { ok: true, detail: 'No free connection check for this provider — it is verified on first generate.' };
});

/**
 * Register the built-in models. Additive and idempotent: it adds only what is
 * missing, keyed on the provider's model id, so calling it again after a new
 * model ships registers that one without disturbing anything already set up.
 *
 * BytePlus keys are NOT set here — the connection is created empty and the key
 * is pasted into APIs & models, which writes it straight to the backend store.
 */
app.post('/api/models/seed', async () => {
  const creds = await listAll<Record<string, any>>('credentials');
  const models = await listAll<Record<string, any>>('models');
  const added: string[] = [];

  const credFor = async (
    provider: ProviderKind,
    fields: Record<string, unknown>,
  ): Promise<{ id: string }> => {
    const found = creds.find((c) => c.provider === provider);
    if (found) return found as { id: string };
    const made = (await upsert('credentials', { provider, ...fields })) as { id: string };
    creds.push(made as Record<string, any>);
    added.push(String(fields.name));
    return made;
  };

  const addModel = async (
    credentialId: string,
    defaults: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): Promise<void> => {
    if (models.some((m) => m.modelId === defaults.modelId)) return;
    await upsert('models', { ...defaults, ...extra, credentialId });
    added.push(String(defaults.name));
  };

  const gemini = await credFor('google-gemini', {
    name: 'Gemini (deploy key)',
    hasKey: Boolean(config.googleApiKey),
    usesEnvKey: true,
    enabled: true,
    notes: 'Uses the GOOGLE_API_KEY set on the Cloud Run service.',
  });
  await addModel(gemini.id, { ...OMNI_FLASH_DEFAULTS, modelId: config.omniFlashModel }, {
    isDefault: !models.some((m) => m.isDefault),
  });

  const byteplus = await credFor('byteplus-ark', {
    name: 'BytePlus ModelArk',
    hasKey: false,
    enabled: true,
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    notes: 'Paste the ModelArk API key below — it is stored server-side only.',
  });
  await addModel(byteplus.id, SEEDANCE_25_DEFAULTS);
  await addModel(byteplus.id, SEEDANCE_20_FAST_DEFAULTS);

  return { added, models: await listAll('models'), credentials: await listAll('credentials') };
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
  /** Files this generation under a project so it shows in that project's history. */
  projectId?: string;
  projectName?: string;
}

interface ResolvedModel {
  provider: ProviderKind;
  modelId: string;
  apiKey: string;
  maxReferenceImages: number;
  usdPerSecond: number;
  supportsImageToVideo: boolean;
  minClipSec: number;
  maxClipSec: number;
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
      provider: 'google-gemini',
      modelId: config.omniFlashModel,
      apiKey: config.googleApiKey,
      maxReferenceImages: 2,
      usdPerSecond: config.usdPerSecond,
      supportsImageToVideo: true,
      minClipSec: 3,
      maxClipSec: 10,
      label: config.omniFlashModel,
    };
  }

  const cred = await getOne<Record<string, any>>('credentials', chosen.credentialId);
  if (!cred) return { code: 'credential-missing', error: `Model "${chosen.name}" has no API credential.` };
  const provider = cred.provider as ProviderKind;
  if (provider !== 'google-gemini' && provider !== 'byteplus-ark') {
    return {
      code: 'provider-not-implemented',
      error: `${cred.provider} is registered but its video adapter isn't implemented yet — Google Gemini and BytePlus ModelArk generate today.`,
    };
  }

  const apiKey = cred.usesEnvKey ? config.googleApiKey : await getCredentialKey(cred.id);
  if (!apiKey)
    return { code: 'credential-no-key', error: `No API key saved for "${cred.name}". Add one in APIs & models.` };

  return {
    provider,
    modelId: chosen.modelId,
    apiKey,
    maxReferenceImages: Number(chosen.maxReferenceImages ?? 2),
    usdPerSecond: Number(chosen.usdPerSecond ?? config.usdPerSecond),
    supportsImageToVideo: chosen.supportsImageToVideo !== false,
    minClipSec: Number(chosen.minClipSec ?? 3),
    maxClipSec: Number(chosen.maxClipSec ?? 10),
    label: chosen.name ?? chosen.modelId,
  };
}

/**
 * Render one segment on whichever provider the project picked.
 *
 * Both adapters take the same thing — a prompt, the brief's aspect, a duration,
 * optionally the previous segment's closing frame plus the brief's reference
 * images — and return finished MP4 bytes, so the generate and refine loops stay
 * provider-agnostic.
 */
async function renderSegment(
  model: ResolvedModel,
  req: {
    prompt: string;
    aspect: Brief['aspect'];
    duration: number;
    seedFrame?: Buffer;
    references: OmniRef[];
  },
): Promise<{ bytes: Buffer; interactionId: string }> {
  const seeded = Boolean(req.seedFrame) && model.supportsImageToVideo;

  if (model.provider === 'byteplus-ark') {
    const refs: SeedanceRef[] = [];
    if (seeded) refs.push({ data: req.seedFrame!.toString('base64'), mimeType: 'image/jpeg', role: 'first_frame' });
    for (const r of req.references.slice(0, Math.max(0, model.maxReferenceImages - refs.length))) {
      if (r.data) refs.push({ data: r.data, mimeType: r.mimeType, role: 'reference_image' });
    }
    const clip = await generateSeedanceClip(
      {
        prompt: req.prompt,
        model: model.modelId,
        aspect: req.aspect,
        resolution: RES,
        duration: req.duration,
        minSec: model.minClipSec,
        maxSec: model.maxClipSec,
        references: refs.length ? refs : undefined,
        generateAudio: true,
      },
      model.apiKey,
    );
    return { bytes: clip.bytes, interactionId: clip.taskId };
  }

  // Google Gemini (Omni Flash): the seed frame is frame 1, so the model
  // continues the motion rather than restarting it.
  const refs: OmniRef[] = [];
  if (seeded) refs.push({ data: req.seedFrame!.toString('base64'), mimeType: 'image/jpeg', kind: 'image' });
  refs.push(...req.references.slice(0, Math.max(0, model.maxReferenceImages - refs.length)));

  const clip = await generateClip(
    {
      prompt: req.prompt,
      aspect: req.aspect,
      resolution: RES,
      references: refs.length ? refs : undefined,
      task: seeded ? 'image_to_video' : refs.length ? 'reference_to_video' : 'text_to_video',
      model: model.modelId,
    },
    model.apiKey,
  );
  const bytes = clip.base64
    ? Buffer.from(clip.base64, 'base64')
    : clip.fileId
      ? (await downloadFile(clip.fileId, model.apiKey)).bytes
      : null;
  if (!bytes) throw new OmniFlashError('omni-flash-no-video', 'Clip had neither base64 nor a file id.');
  return { bytes, interactionId: clip.interactionId };
}

/**
 * Read the brief's attachments back out of Cloud Storage and sort them: image
 * references get grounded into the model, logos are overlay assets that post
 * composites (the model garbles any logo it tries to draw).
 */
async function loadBriefAssets(brief: Brief): Promise<{
  references: OmniRef[];
  dealerLogo?: Buffer;
  brandLogo?: Buffer;
}> {
  const references: OmniRef[] = [];
  let dealerLogo: Buffer | undefined;
  let brandLogo: Buffer | undefined;
  for (const a of brief.attachments ?? []) {
    if (!a.storagePath) continue;
    const obj = await readObject(a.storagePath).catch(() => null);
    if (!obj) continue;
    if (a.kind === 'logo') {
      dealerLogo = obj.bytes;
      continue;
    }
    if (a.kind === 'brand-logo') {
      brandLogo = obj.bytes;
      continue;
    }
    references.push({
      data: obj.bytes.toString('base64'),
      mimeType: obj.contentType || 'image/jpeg',
      kind: 'image',
    });
  }
  return { references, dealerLogo, brandLogo };
}

/** The deterministic brand furniture laid over the finished cut. */
function buildOverlay(brief: Brief, dealerLogo?: Buffer, brandLogo?: Buffer): BrandOverlay {
  const copy = overlayCopy(brief);
  return {
    footerText: copy.footerText,
    dealerLogo,
    brandLogo,
    endCard:
      brief.endCardOn && copy.endCardLines.length ? { lines: copy.endCardLines, seconds: 3 } : undefined,
    transition: 0.5,
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
    projectId: req.body?.projectId,
    projectName: req.body?.projectName,
    label: `${cost.totalSeconds}s · ${brief.categories.length} use case${brief.categories.length === 1 ? '' : 's'}`,
    modelName: resolved.label,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    categories: brief.categories,
    dealerName: brief.dealer.dealerName,
    aspect: brief.aspect,
    resolution: RES,
    totalSeconds: cost.totalSeconds,
    costInr: cost.inr,
    costUsd: cost.usd,
    usdPerSecond: resolved.usdPerSecond,
    clips,
  };
  await saveJob(record).catch((e) => app.log.error(e, 'saveJob failed'));

  const { references, dealerLogo, brandLogo } = await loadBriefAssets(brief);

  // No `extend` — each segment is an independent create, seeded with the
  // PREVIOUS segment's last frame so the presenter / car / setting stay
  // identical across the cut. All segments are ffmpeg-stitched into one video.
  // On a model that renders the whole duration in one call (Seedance 2.5 does
  // 30s) there is only ever one segment, and none of this applies.
  try {
    const segmentBytes: Buffer[] = [];
    let prevBytes: Buffer | null = null;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isFirst = i === 0;
      const seedFrame = !isFirst && prevBytes ? ((await lastFrame(prevBytes)) ?? undefined) : undefined;

      const { bytes, interactionId } = await renderSegment(resolved, {
        prompt: isFirst ? part.text : part.continuationText || part.text,
        aspect: brief.aspect,
        duration: part.duration,
        seedFrame,
        references,
      });

      const storagePath = await uploadClip(jobId, part.partNum, bytes, 'video/mp4');
      clips[i] = { ...clips[i]!, interactionId, storagePath, status: 'done' };
      await updateJob(jobId, { clips });

      segmentBytes.push(bytes);
      prevBytes = bytes;
    }

    // Post-production: crossfade the segments, append a real end card, and
    // overlay the footer bar + logos. Everything that must be legible is drawn
    // here rather than generated.
    const finalBytes = await composeFinal(segmentBytes, buildOverlay(brief, dealerLogo, brandLogo));
    const finalStoragePath = await uploadClip(jobId, 0, finalBytes, 'video/mp4'); // part 0 = final

    // Thumbnail for the project's generation history.
    let posterPath: string | undefined;
    const poster = await posterFrame(finalBytes).catch(() => null);
    if (poster) {
      const put = await putRef(`poster-${jobId}.jpg`, 'image/jpeg', poster).catch(() => null);
      posterPath = put?.storagePath;
    }

    await updateJob(jobId, { status: 'done', clips, finalStoragePath, posterPath });

    // Roll the spend up onto the project so the list can show it without
    // reading every job.
    if (req.body?.projectId) {
      const proj = await getOne<{ generationCount?: number; totalCostInr?: number }>(
        'projects',
        req.body.projectId,
      );
      if (proj) {
        await patch('projects', req.body.projectId, {
          generationCount: (proj.generationCount ?? 0) + 1,
          totalCostInr: (proj.totalCostInr ?? 0) + cost.inr,
          lastJobId: jobId,
          lastFinalUrl: `/api/clips/${jobId}/final`,
          status: 'generated',
        }).catch(() => {});
      }
    }
    return {
      jobId,
      status: 'done',
      cost,
      finalUrl: `/api/clips/${jobId}/final`,
      clips: clipsForClient(jobId, clips),
    };
  } catch (err) {
    const e = err as OmniFlashError | SeedanceError;
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
    return reply.code(e instanceof OmniFlashError || e instanceof SeedanceError ? e.status : 502).send({
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

/**
 * Retake only what is wrong.
 *
 * A finished video is usually right apart from one or two details, and paying to
 * regenerate all of it burns the segments that were already good. This re-runs
 * just the segments named in `redo` — with the reviewer's note appended to their
 * prompts — re-uses the rest of the stored clips byte for byte, and restitches.
 * `redo: []` is the free path: no model call at all, just a fresh composite, so
 * a footer, logo or end-card correction costs nothing.
 */
interface RefineBody {
  brief: Brief;
  parts: PromptPart[];
  /** Part numbers to regenerate. Empty = restitch the stored segments only. */
  redo?: number[];
  feedback?: string;
  modelId?: string;
  projectId?: string;
  projectName?: string;
  confirmedCostInr?: number;
}

app.post<{ Params: { jobId: string }; Body: RefineBody }>(
  '/api/generate/:jobId/refine',
  async (req, reply) => {
    const source = await getJob(req.params.jobId);
    if (!source) return reply.code(404).send({ code: 'not-found', message: 'No such job to refine' });

    const { brief, parts } = req.body ?? ({} as RefineBody);
    if (!brief || !Array.isArray(parts) || parts.length === 0) {
      return reply.code(400).send({ code: 'bad-request', message: 'brief and parts are required' });
    }

    const redo = [...new Set((req.body?.redo ?? []).map(Number))]
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const feedback = (req.body?.feedback ?? '').trim();

    // The stored clips only line up with the plan if the brief has not changed
    // shape since that run. If it has, re-using them would splice a stale scene
    // into a different edit — say so instead of quietly producing a mess.
    const stored = new Map(
      (source.clips ?? []).filter((c) => c.status === 'done' && c.storagePath).map((c) => [c.partNum, c]),
    );
    const stale = parts
      .filter((p) => !redo.includes(p.partNum))
      .filter((p) => {
        const c = stored.get(p.partNum);
        return !c || Math.abs((c.seconds ?? 0) - p.duration) > 0.6;
      });
    if (stale.length) {
      return reply.code(409).send({
        code: 'segments-stale',
        message: `The storyboard has changed since that run, so segment${
          stale.length > 1 ? 's' : ''
        } ${stale.map((p) => p.partNum).join(', ')} no longer match what was saved. Generate a fresh video instead of refining.`,
      });
    }

    // Only the re-run segments are billed. A restitch is free.
    let resolved: ResolvedModel | null = null;
    if (redo.length) {
      const picked = await resolveModel(req.body?.modelId);
      if ('error' in picked) return reply.code(503).send({ code: picked.code, message: picked.error });
      resolved = picked;
    }
    const usdPerSecond = resolved?.usdPerSecond ?? source.usdPerSecond ?? config.usdPerSecond;
    const redoSeconds = parts
      .filter((p) => redo.includes(p.partNum))
      .reduce((a, p) => a + p.duration, 0);
    const cost = estimateSegmentsCost(redoSeconds, redo.length, { usdPerSecond });
    if (cost.needsConfirmation && (req.body?.confirmedCostInr ?? 0) < cost.inr) {
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
    const totalSeconds = parts.reduce((a, p) => a + p.duration, 0);
    const record: JobRecord = {
      jobId,
      parentJobId: source.jobId,
      refinedParts: redo,
      feedback: feedback || undefined,
      projectId: req.body?.projectId ?? source.projectId,
      projectName: req.body?.projectName ?? source.projectName,
      label: redo.length
        ? `Retake · segment${redo.length > 1 ? 's' : ''} ${redo.join(', ')} of ${parts.length}`
        : 'Restitch · overlays only',
      modelName: resolved?.label ?? source.modelName,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      categories: brief.categories,
      dealerName: brief.dealer.dealerName,
      aspect: brief.aspect,
      resolution: RES,
      totalSeconds: Math.round(totalSeconds * 10) / 10,
      costInr: cost.inr,
      costUsd: cost.usd,
      usdPerSecond,
      clips,
    };
    await saveJob(record).catch((e) => app.log.error(e, 'saveJob failed'));

    const { references, dealerLogo, brandLogo } = await loadBriefAssets(brief);

    try {
      const segmentBytes: Buffer[] = [];
      let prevBytes: Buffer | null = null;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        let bytes: Buffer;

        if (!redo.includes(part.partNum)) {
          const from = stored.get(part.partNum)!;
          const obj = await readObject(from.storagePath);
          if (!obj) throw new OmniFlashError('segment-missing', `Saved segment ${part.partNum} is gone from storage.`);
          bytes = obj.bytes;
          clips[i] = {
            ...clips[i]!,
            interactionId: from.interactionId,
            storagePath: await uploadClip(jobId, part.partNum, bytes, 'video/mp4'),
            status: 'done',
            reused: true,
          };
        } else {
          const isFirst = i === 0;
          // Seed from whatever now precedes this segment — a re-used clip or a
          // freshly retaken one — so the retake still cuts against its neighbour.
          const seedFrame = !isFirst && prevBytes ? ((await lastFrame(prevBytes)) ?? undefined) : undefined;
          const rendered = await renderSegment(resolved!, {
            prompt: applyFeedback(isFirst ? part.text : part.continuationText || part.text, feedback),
            aspect: brief.aspect,
            duration: part.duration,
            seedFrame,
            references,
          });
          bytes = rendered.bytes;
          clips[i] = {
            ...clips[i]!,
            interactionId: rendered.interactionId,
            storagePath: await uploadClip(jobId, part.partNum, bytes, 'video/mp4'),
            status: 'done',
          };
        }

        await updateJob(jobId, { clips });
        segmentBytes.push(bytes);
        prevBytes = bytes;
      }

      // Overlay copy is rebuilt from the current brief, so a footer or end-card
      // correction lands here even on the free restitch path.
      const finalBytes = await composeFinal(segmentBytes, buildOverlay(brief, dealerLogo, brandLogo));
      const finalStoragePath = await uploadClip(jobId, 0, finalBytes, 'video/mp4'); // part 0 = final

      let posterPath: string | undefined;
      const poster = await posterFrame(finalBytes).catch(() => null);
      if (poster) {
        posterPath = (await putRef(`poster-${jobId}.jpg`, 'image/jpeg', poster).catch(() => null))?.storagePath;
      }

      await updateJob(jobId, { status: 'done', clips, finalStoragePath, posterPath });

      const projectId = req.body?.projectId ?? source.projectId;
      if (projectId) {
        const proj = await getOne<{ generationCount?: number; totalCostInr?: number }>('projects', projectId);
        if (proj) {
          await patch('projects', projectId, {
            generationCount: (proj.generationCount ?? 0) + 1,
            totalCostInr: (proj.totalCostInr ?? 0) + cost.inr,
            lastJobId: jobId,
            lastFinalUrl: `/api/clips/${jobId}/final`,
            status: 'generated',
          }).catch(() => {});
        }
      }

      return {
        jobId,
        status: 'done',
        cost,
        finalUrl: `/api/clips/${jobId}/final`,
        clips: clipsForClient(jobId, clips),
      };
    } catch (err) {
      const e = err as OmniFlashError | SeedanceError;
      const failedIdx = clips.findIndex((c) => c.status === 'pending');
      if (failedIdx >= 0) clips[failedIdx] = { ...clips[failedIdx]!, status: 'failed', error: e.message };
      await updateJob(jobId, { status: 'failed', error: e.message, clips }).catch(() => {});
      return reply.code(e instanceof OmniFlashError || e instanceof SeedanceError ? e.status : 502).send({
        code: e.code ?? 'refine-failed',
        message: e.message,
        jobId,
        clips: clipsForClient(jobId, clips),
      });
    }
  },
);

/** Every generation ever made for a project — nothing is overwritten. */
app.get<{ Params: { id: string } }>('/api/projects/:id/generations', async (req) => {
  const jobs = await listJobsForProject(req.params.id);
  return {
    items: jobs.map((j) => ({
      jobId: j.jobId,
      label: j.label,
      modelName: j.modelName,
      status: j.status,
      createdAt: j.createdAt,
      totalSeconds: j.totalSeconds,
      costInr: j.costInr,
      costUsd: j.costUsd,
      usdPerSecond: j.usdPerSecond,
      aspect: j.aspect,
      resolution: j.resolution,
      segments: j.clips?.length ?? 0,
      dealerName: j.dealerName,
      categories: j.categories,
      error: j.error,
      parentJobId: j.parentJobId,
      refinedParts: j.refinedParts,
      feedback: j.feedback,
      finalUrl: j.finalStoragePath ? `/api/clips/${j.jobId}/final` : null,
      posterUrl: j.posterPath ? `/api/clips/${j.jobId}/poster` : null,
    })),
  };
});

app.get<{ Params: { jobId: string; part: string } }>('/api/clips/:jobId/:part', async (req, reply) => {
  const job = await getJob(req.params.jobId);
  if (!job) return reply.code(404).send({ code: 'not-found', message: 'No such job' });
  const storagePath =
    req.params.part === 'final'
      ? job.finalStoragePath
      : req.params.part === 'poster'
        ? job.posterPath
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
