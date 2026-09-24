/**
 * The engine API: a prompt in, a picture or a film out.
 *
 * Everything else in this app is a workflow — a brief, a storyboard, a client, a
 * vehicle library — and none of that belongs in another team's code. So `/v1` is
 * the plain surface underneath it: text, a few reference images or clips, and a
 * file back. No briefs, no scenes, no projects.
 *
 * A picture is made while the caller waits. A film is not — it takes minutes, so
 * it is a job with an id and a URL to ask about it. Cloud Run gives a container
 * no processor between requests, so the work cannot simply carry on after the
 * answer goes out: the job is written down, the service calls itself once to run
 * it, and that second request is what does the work. The token for that call
 * lives on the job and is spent the moment it is used, so a job runs once.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_USD_TO_INR, usageCostUsd, type TokenUsage } from '@ava/shared';
import { ensureFirebase, putRef, readObject, safeRefName } from './store.js';
import { composeClean, posterFrame } from './post.js';
import { requestImage, resolveImageModel, resolveNanoBanana2, SceneImageError, type ImagePart } from './sceneImage.js';
import { recordUsage } from './spendLog.js';
import { recordApiUse, spentToday, verifyApiKey, type ApiKeyRecord, type ApiScope } from './apiKeys.js';

/* ============================== what a caller may ask for ============================== */

/** The shapes a picture may be drawn at. Nano Banana 2 goes no wider than 21:9. */
const IMAGE_ASPECTS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
const IMAGE_SIZES = ['1K', '2K', '4K'] as const;
const VIDEO_ASPECTS = ['16:9', '9:16', '1:1'] as const;
const VIDEO_RESOLUTIONS = ['720p', '1080p'] as const;

/** What a film may run to, in seconds. Longer asks are made in parts and joined. */
const MAX_SECONDS = 30;
/** Pictures and clips a caller may send with one request. */
const MAX_IMAGE_REFS = 6;
const MAX_VIDEO_REFS = 3;
const MAX_REF_BYTES = 15 * 1024 * 1024;
/** Films a key may have in flight at once. */
const MAX_LIVE_JOBS = 2;

type Kind = 'image' | 'video';

export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (all.includes(v as T) ? (v as T) : fallback);

/* ============================== references ============================== */

export interface RefInput {
  url?: unknown;
  data?: unknown;
  label?: unknown;
}
export interface LoadedRef {
  bytes: Buffer;
  mimeType: string;
  label: string;
  kind: 'image' | 'video';
}

/** Hosts a reference may not come from: this service's own network, and the metadata server. */
const PRIVATE_HOST =
  /^(localhost|127\.|0\.0\.0\.0|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|metadata\.google\.internal)/i;

/**
 * One reference, as bytes.
 *
 * Either inline — a data: URI the caller already holds — or an https link this
 * service fetches. A link is followed at most twice, and never to a private
 * address: the engine fetches what a caller names, and a caller must not be able
 * to name the inside of our own network.
 */
export async function loadRef(ref: RefInput, index: number): Promise<LoadedRef> {
  const label = str(ref.label, 120) || `reference ${index + 1}`;
  const data = typeof ref.data === 'string' ? ref.data : '';
  if (data) {
    const m = /^data:([\w./+-]+);base64,(.+)$/s.exec(data.trim());
    // A data: URI that does not parse is a mistake, not base64 to decode anyway:
    // decoding it drops the punctuation and hands the model a few stray bytes.
    if (!m && /^data:/i.test(data.trim())) throw new EngineError('bad-reference', `Reference ${index + 1} is not a readable data URI.`);
    const bytes = Buffer.from(m ? m[2]! : data.trim(), 'base64');
    if (!bytes.length) throw new EngineError('bad-reference', `Reference ${index + 1} is not readable base64.`);
    if (bytes.length > MAX_REF_BYTES) throw new EngineError('reference-too-large', `Reference ${index + 1} is larger than 15 MB.`);
    return { bytes, mimeType: m?.[1] ?? 'image/jpeg', label, kind: (m?.[1] ?? '').startsWith('video/') ? 'video' : 'image' };
  }
  const link = str(ref.url, 2000);
  if (!link) throw new EngineError('bad-reference', `Reference ${index + 1} needs a url or data.`);
  let target = link;
  for (let hop = 0; hop < 3; hop++) {
    let u: URL;
    try {
      u = new URL(target);
    } catch {
      throw new EngineError('bad-reference', `Reference ${index + 1} is not a valid URL.`);
    }
    if (u.protocol !== 'https:') throw new EngineError('bad-reference', `Reference ${index + 1} must be an https link.`);
    if (PRIVATE_HOST.test(u.hostname)) throw new EngineError('bad-reference', `Reference ${index + 1} points inside a private network.`);
    const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res) throw new EngineError('reference-unreachable', `Reference ${index + 1} could not be fetched.`, 502);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      target = new URL(res.headers.get('location')!, u).toString();
      continue;
    }
    if (!res.ok) throw new EngineError('reference-unreachable', `Reference ${index + 1} answered ${res.status}.`, 502);
    const mimeType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim() || 'image/jpeg';
    if (!/^(image|video)\//.test(mimeType)) throw new EngineError('bad-reference', `Reference ${index + 1} is ${mimeType}, not an image or a video.`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new EngineError('bad-reference', `Reference ${index + 1} is empty.`);
    if (buf.length > MAX_REF_BYTES) throw new EngineError('reference-too-large', `Reference ${index + 1} is larger than 15 MB.`);
    return { bytes: buf, mimeType, label, kind: mimeType.startsWith('video/') ? 'video' : 'image' };
  }
  throw new EngineError('bad-reference', `Reference ${index + 1} redirects too many times.`);
}

/** Every reference of a request, in order, with the caps for what it is for. */
async function loadRefs(raw: unknown, caps: { images: number; videos: number }): Promise<LoadedRef[]> {
  const list = Array.isArray(raw) ? raw.slice(0, caps.images + caps.videos) : [];
  const out: LoadedRef[] = [];
  for (const [i, ref] of list.entries()) {
    const loaded = await loadRef((ref ?? {}) as RefInput, i);
    const already = out.filter((r) => r.kind === loaded.kind).length;
    const cap = loaded.kind === 'video' ? caps.videos : caps.images;
    if (already >= cap) {
      throw new EngineError('too-many-references', `At most ${cap} reference ${loaded.kind === 'video' ? 'videos' : 'images'} for this kind of request.`);
    }
    out.push(loaded);
  }
  return out;
}

/* ============================== parts of a film ============================== */

/**
 * How a film of this length is made: whole if the model can draw it in one go,
 * otherwise in even parts no longer than it can, each carrying on from the last.
 */
export function splitSeconds(seconds: number, minClip: number, maxClip: number): number[] {
  const total = Math.max(minClip, Math.min(MAX_SECONDS, Math.round(seconds)));
  if (total <= maxClip) return [total];
  let n = Math.ceil(total / maxClip);
  // Parts a model would refuse as too short are better as fewer, longer parts.
  while (n > 1 && total / n < minClip) n -= 1;
  const base = Math.floor(total / n);
  const parts = Array.from({ length: n }, () => base);
  for (let i = 0; i < total - base * n; i++) parts[i] = parts[i]! + 1;
  return parts;
}

/* ============================== jobs ============================== */

const JOBS = 'engineJobs';

interface EngineJob {
  id: string;
  kind: Kind;
  status: 'queued' | 'running' | 'done' | 'failed';
  keyId: string;
  request: {
    prompt: string;
    aspect: string;
    seconds: number;
    resolution: string;
    modelId?: string;
    refs: Array<{ storagePath: string; mimeType: string; label: string; kind: 'image' | 'video' }>;
    metadata?: Record<string, unknown>;
  };
  /** Spent once, by the request that runs the job. */
  runToken?: string;
  parts?: { done: number; total: number };
  result?: { storagePath: string; filename: string; mimeType: string; seconds: number; model: string };
  costInr?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const jobs = () => {
  ensureFirebase();
  return getFirestore().collection(JOBS);
};
const readJob = async (id: string): Promise<EngineJob | null> => ((await jobs().doc(id).get()).data() as EngineJob | undefined) ?? null;
const writeJob = async (id: string, patch: Partial<EngineJob>): Promise<void> => {
  await jobs().doc(id).set({ ...patch, updatedAt: Date.now() }, { merge: true });
};

/* ============================== what goes back ============================== */

const fileUrl = (base: string, storagePath: string): string => `${base}/v1/files/${storagePath.split('/')[1]}/${storagePath.split('/').slice(2).join('/')}`;

/** Where this service can call itself: the host the caller reached, so a preview job runs preview code. */
const selfBase = (host: string | undefined): string => `https://${host ?? ''}`;

const jobView = (job: EngineJob, base: string) => ({
  id: job.id,
  object: 'video',
  status: job.status,
  created: job.createdAt,
  updated: job.updatedAt,
  seconds: job.request.seconds,
  aspect: job.request.aspect,
  ...(job.parts ? { parts: job.parts } : {}),
  ...(job.result
    ? {
        url: fileUrl(base, job.result.storagePath),
        mimeType: job.result.mimeType,
        model: job.result.model,
      }
    : {}),
  ...(typeof job.costInr === 'number' ? { cost: { inr: Math.round(job.costInr * 100) / 100 } } : {}),
  ...(job.error ? { error: { code: 'generation-failed', message: job.error } } : {}),
  ...(job.request.metadata ? { metadata: job.request.metadata } : {}),
  poll: `${base}/v1/videos/${job.id}`,
});

/* ============================== the routes ============================== */

export interface EngineDeps {
  /** The video model this app is configured to use, with its key and its limits. */
  resolveModel: (id?: string) => Promise<
    | {
        provider: string;
        modelId: string;
        apiKey: string;
        maxReferenceImages: number;
        usdPerSecond: number;
        minClipSec: number;
        maxClipSec: number;
        label: string;
        usdPerSecondByResolution?: Record<string, number | undefined>;
        resolutions?: string[];
      }
    | { error: string; code: string }
  >;
  /** One clip from that model — the same call the films are made with. */
  renderSegment: (
    model: never,
    req: {
      prompt: string;
      aspect: string;
      duration: number;
      resolution: string;
      seedFrame?: Buffer;
      references: Array<{ ref: { data: string; mimeType: string; kind: 'image' | 'video' }; filename: string; label: string }>;
      videoRefs?: Array<{ ref: { data: string; mimeType: string; kind: 'image' | 'video' }; filename: string; label: string }>;
      plain?: boolean;
    },
  ) => Promise<{ bytes: Buffer; interactionId: string; renderResolution: string }>;
  googleKey: () => Promise<string | undefined>;
}

export function registerEngine(app: FastifyInstance, deps: EngineDeps): void {
  /* ---- who is calling ---- */

  app.addHook('preHandler', async (req, reply) => {
    const url = (req.raw.url ?? '').split('?')[0] ?? '';
    if (!url.startsWith('/v1')) return;
    if (req.method === 'OPTIONS') return;
    // A file is a permanent link, made to be pasted into a page or handed on.
    if (url.startsWith('/v1/files/')) return;
    // The service calling itself to run a job proves it with the job's own token.
    if (url === '/v1/run') return;
    if (url === '/v1' || url === '/v1/') return;

    const secret = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const key = await verifyApiKey(secret);
    if (!key) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Send a live API key as "Authorization: Bearer ava_live_…".' } });
    }
    (req as { apiKey?: ApiKeyRecord }).apiKey = key;
  });

  const keyOf = (req: unknown): ApiKeyRecord => (req as { apiKey: ApiKeyRecord }).apiKey;
  const allows = (key: ApiKeyRecord, scope: ApiScope): boolean => (key.scopes ?? []).includes(scope);

  /** A key's own daily cap, checked before anything is spent. */
  const withinCap = async (key: ApiKeyRecord, about: number): Promise<void> => {
    if (!key.dailyCapInr) return;
    const spent = await spentToday(key.id);
    if (spent + about > key.dailyCapInr) {
      throw new EngineError('daily-cap-reached', `This key has spent ₹${Math.round(spent)} of its ₹${key.dailyCapInr} for today.`, 429);
    }
  };

  const fail = (reply: never, e: unknown) => {
    const err = e as EngineError;
    const status = typeof err?.status === 'number' ? err.status : 502;
    const body = { error: { code: err?.code ?? 'failed', message: err?.message ?? 'The engine could not answer.' } };
    return (reply as unknown as { code: (n: number) => { send: (b: unknown) => unknown } }).code(status).send(body);
  };

  /* ---- what is here ---- */

  app.get('/v1', async (req) => ({
    name: 'AVA engine',
    version: '1',
    endpoints: {
      images: { method: 'POST', path: '/v1/images', returns: 'the picture, while you wait' },
      videos: { method: 'POST', path: '/v1/videos', returns: 'a job id; ask /v1/videos/{id} until it is done' },
      video: { method: 'GET', path: '/v1/videos/{id}' },
      me: { method: 'GET', path: '/v1/me' },
    },
    limits: {
      seconds: MAX_SECONDS,
      referenceImages: MAX_IMAGE_REFS,
      referenceVideos: MAX_VIDEO_REFS,
      referenceBytes: MAX_REF_BYTES,
      imageAspects: IMAGE_ASPECTS,
      imageSizes: IMAGE_SIZES,
      videoAspects: VIDEO_ASPECTS,
      videoResolutions: VIDEO_RESOLUTIONS,
    },
    docs: `${selfBase(req.headers.host)}/v1`,
  }));

  app.get('/v1/me', async (req) => {
    const key = keyOf(req);
    return {
      key: { id: key.id, name: key.name, hint: key.hint, scopes: key.scopes, dailyCapInr: key.dailyCapInr ?? null },
      usage: { calls: key.calls ?? 0, costInr: Math.round((key.costInr ?? 0) * 100) / 100, spentTodayInr: Math.round(await spentToday(key.id)) },
    };
  });

  /* ---- a picture, while the caller waits ---- */

  app.post<{ Body: { prompt?: unknown; references?: unknown; aspect?: unknown; size?: unknown; metadata?: unknown } }>(
    '/v1/images',
    async (req, reply) => {
      const key = keyOf(req);
      if (!allows(key, 'images')) return reply.code(403).send({ error: { code: 'forbidden', message: 'This key may not make pictures.' } });
      const prompt = str(req.body?.prompt, 4000);
      if (!prompt) return reply.code(400).send({ error: { code: 'bad-request', message: 'A prompt is required.' } });
      const aspect = oneOf(req.body?.aspect, IMAGE_ASPECTS, '1:1');
      const size = oneOf(req.body?.size, IMAGE_SIZES, '2K');
      const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? (req.body.metadata as Record<string, unknown>) : undefined;
      try {
        await withinCap(key, 12);
        const apiKey = await deps.googleKey();
        if (!apiKey) throw new EngineError('no-key', 'The engine has no Google key configured.', 503);
        const refs = (await loadRefs(req.body?.references, { images: MAX_IMAGE_REFS, videos: 0 })).filter((r) => r.kind === 'image');
        const model = await resolveNanoBanana2(apiKey).catch(() => resolveImageModel(apiKey));
        const parts: ImagePart[] = [
          {
            text: refs.length
              ? `${prompt}\n\n## Reference images\n${refs.map((r, i) => `<IMAGE_REF_${i}> — ${r.label}`).join('\n')}\nThese are records of what the subjects look like. Build them exactly as they are; never draw the photographs themselves, or a frame, screen or collage showing them.`
              : prompt,
          },
          ...refs.map((r) => ({ inline_data: { mime_type: r.mimeType, data: r.bytes.toString('base64') } })),
        ];
        const out = await requestImage(model, parts, apiKey, [{ aspectRatio: aspect, imageSize: size }, { aspectRatio: aspect }], 0.6, 'Engine API');
        const costInr = out.usage ? usageCostUsd(out.model, out.usage as TokenUsage) * DEFAULT_USD_TO_INR : 0;
        const ext = /jpe?g/i.test(out.mimeType) ? 'jpg' : 'png';
        const put = await putRef(`image.${ext}`, out.mimeType, out.bytes);
        void recordApiUse(key.id, costInr);
        return {
          id: `img_${put.refId}`,
          object: 'image',
          created: Date.now(),
          model: out.model,
          aspect,
          url: fileUrl(selfBase(req.headers.host), put.storagePath),
          mimeType: out.mimeType,
          bytes: out.bytes.length,
          cost: { inr: Math.round(costInr * 100) / 100 },
          ...(metadata ? { metadata } : {}),
        };
      } catch (e) {
        if (e instanceof SceneImageError) return fail(reply as never, new EngineError(e.code, e.message, e.status));
        return fail(reply as never, e);
      }
    },
  );

  /* ---- a film: a job, and a URL to ask about it ---- */

  app.post<{ Body: { prompt?: unknown; references?: unknown; aspect?: unknown; seconds?: unknown; resolution?: unknown; model?: unknown; metadata?: unknown } }>(
    '/v1/videos',
    async (req, reply) => {
      const key = keyOf(req);
      if (!allows(key, 'videos')) return reply.code(403).send({ error: { code: 'forbidden', message: 'This key may not make films.' } });
      const prompt = str(req.body?.prompt, 4000);
      if (!prompt) return reply.code(400).send({ error: { code: 'bad-request', message: 'A prompt is required.' } });
      const seconds = Math.max(1, Math.min(MAX_SECONDS, Math.round(Number(req.body?.seconds) || 8)));
      const aspect = oneOf(req.body?.aspect, VIDEO_ASPECTS, '16:9');
      const resolution = oneOf(req.body?.resolution, VIDEO_RESOLUTIONS, '1080p');
      const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? (req.body.metadata as Record<string, unknown>) : undefined;
      try {
        const model = await deps.resolveModel(str(req.body?.model, 80) || undefined);
        if ('error' in model) throw new EngineError(model.code, model.error, 503);
        const perSecond = model.usdPerSecondByResolution?.[resolution] ?? model.usdPerSecond;
        await withinCap(key, perSecond * seconds * DEFAULT_USD_TO_INR);

        const live = await jobs().where('keyId', '==', key.id).where('status', 'in', ['queued', 'running']).get();
        if (live.size >= MAX_LIVE_JOBS) {
          throw new EngineError('too-many-jobs', `This key already has ${live.size} films being made. Wait for one to finish.`, 429);
        }

        const refs = await loadRefs(req.body?.references, { images: Math.min(MAX_IMAGE_REFS, model.maxReferenceImages), videos: MAX_VIDEO_REFS });
        const stored = await Promise.all(
          refs.map(async (r) => {
            const put = await putRef(`ref.${r.mimeType.split('/')[1] ?? 'bin'}`, r.mimeType, r.bytes);
            return { storagePath: put.storagePath, mimeType: r.mimeType, label: r.label, kind: r.kind };
          }),
        );

        const id = `vid_${crypto.randomUUID()}`;
        const job: EngineJob = {
          id,
          kind: 'video',
          status: 'queued',
          keyId: key.id,
          request: { prompt, aspect, seconds, resolution, ...(str(req.body?.model, 80) ? { modelId: str(req.body?.model, 80) } : {}), refs: stored, ...(metadata ? { metadata } : {}) },
          runToken: crypto.randomBytes(24).toString('base64url'),
          parts: { done: 0, total: splitSeconds(seconds, model.minClipSec, model.maxClipSec).length },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await jobs().doc(id).set(job);
        kick(job, selfBase(req.headers.host));
        return reply.code(202).send(jobView(job, selfBase(req.headers.host)));
      } catch (e) {
        return fail(reply as never, e);
      }
    },
  );

  app.get<{ Params: { id: string } }>('/v1/videos/:id', async (req, reply) => {
    const key = keyOf(req);
    const job = await readJob(req.params.id);
    if (!job || job.keyId !== key.id) return reply.code(404).send({ error: { code: 'not-found', message: 'No such video.' } });
    // A job that never started — the call that should have run it did not arrive — is started here.
    if (job.status === 'queued' && Date.now() - job.updatedAt > 30_000) kick(job, selfBase(req.headers.host));
    return jobView(job, selfBase(req.headers.host));
  });

  /* ---- the file itself: permanent, and no key needed to fetch it ---- */

  app.get<{ Params: { refId: string; '*': string } }>('/v1/files/:refId/*', async (req, reply) => {
    const name = safeRefName((req.params['*'] ?? '').split('/').pop() ?? '');
    const obj = await readObject(`refs/${req.params.refId}/${name}`);
    if (!obj) return reply.code(404).send({ error: { code: 'not-found', message: 'No such file.' } });
    reply.header('content-type', obj.contentType);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(obj.bytes);
  });

  /* ---- the service running its own job ---- */

  app.post<{ Body: { id?: string; token?: string } }>('/v1/run', async (req, reply) => {
    const id = str(req.body?.id, 80);
    const token = str(req.body?.token, 200);
    const job = id ? await readJob(id) : null;
    if (!job || !job.runToken || job.runToken !== token) return reply.code(404).send({ error: { code: 'not-found', message: 'No such job.' } });
    // The token is spent here, so a second call cannot make the same film twice.
    await writeJob(job.id, { status: 'running', runToken: '' });
    try {
      await runVideo({ ...job, status: 'running' }, deps);
    } catch (e) {
      const err = e as Error;
      app.log.warn({ job: job.id, message: err.message }, 'engine video failed');
      await writeJob(job.id, { status: 'failed', error: err.message.slice(0, 400) });
    }
    return { ok: true };
  });

  /** Ask the service to run a job, without waiting for it. */
  function kick(job: EngineJob, base: string): void {
    if (!job.runToken) return;
    void fetch(`${base}/v1/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: job.id, token: job.runToken }),
      signal: AbortSignal.timeout(3_600_000),
    }).catch((e: Error) => app.log.warn({ job: job.id, message: e.message }, 'engine job could not be started'));
  }
}

/* ============================== making the film ============================== */

async function runVideo(job: EngineJob, deps: EngineDeps): Promise<void> {
  const model = await deps.resolveModel(job.request.modelId);
  if ('error' in model) throw new EngineError(model.code, model.error, 503);
  const parts = splitSeconds(job.request.seconds, model.minClipSec, model.maxClipSec);

  const loaded = await Promise.all(
    job.request.refs.map(async (r) => {
      const obj = await readObject(r.storagePath).catch(() => null);
      return obj ? { ref: { data: obj.bytes.toString('base64'), mimeType: r.mimeType, kind: r.kind }, filename: r.storagePath.split('/').pop()!, label: r.label } : null;
    }),
  );
  const images = loaded.filter((r): r is NonNullable<typeof r> => Boolean(r) && r!.ref.kind === 'image');
  const videos = loaded.filter((r): r is NonNullable<typeof r> => Boolean(r) && r!.ref.kind === 'video');

  const segments: Buffer[] = [];
  let previous: Buffer | null = null;
  for (const [i, duration] of parts.entries()) {
    const continued =
      i === 0
        ? job.request.prompt
        : `${job.request.prompt}\n\nThis is part ${i + 1} of ${parts.length}. Carry straight on from the supplied frame: the same subject, the same place, the same light and the same motion. Do not restart the scene or cut to a new one.`;
    const out = await deps.renderSegment(model as never, {
      prompt: continued,
      aspect: job.request.aspect,
      duration,
      resolution: job.request.resolution,
      ...(previous ? { seedFrame: (await posterFrame(previous, Math.max(0.2, duration - 0.2)).catch(() => null)) ?? undefined } : {}),
      references: images,
      videoRefs: videos,
      plain: true,
    });
    segments.push(out.bytes);
    previous = out.bytes;
    await writeJob(job.id, { parts: { done: i + 1, total: parts.length } });
  }

  const film = segments.length > 1 ? (await composeClean(segments)).bytes : segments[0]!;
  const put = await putRef('video.mp4', 'video/mp4', film);
  const perSecond = model.usdPerSecondByResolution?.[job.request.resolution] ?? model.usdPerSecond;
  const usd = perSecond * parts.reduce((a, b) => a + b, 0);
  const costInr = usd * DEFAULT_USD_TO_INR;
  recordUsage('Engine API', model.modelId, undefined, usd);
  void recordApiUse(job.keyId, costInr);
  await writeJob(job.id, {
    status: 'done',
    result: { storagePath: put.storagePath, filename: 'video.mp4', mimeType: 'video/mp4', seconds: parts.reduce((a, b) => a + b, 0), model: model.modelId },
    costInr,
  });
}
