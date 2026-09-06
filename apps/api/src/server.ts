import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { isPromptOnly, estimateCost, type Brief, type PromptPart } from '@ava/shared';
import { loadConfig } from './config.js';
import { generateClip, downloadFile, OmniFlashError, type OmniRef } from './omniFlash.js';
import { saveJob, updateJob, getJob, uploadClip, streamClip, type JobRecord, type JobClip } from './store.js';

const config = loadConfig();
const app = Fastify({ logger: true, bodyLimit: 15 * 1024 * 1024 });

app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('access-control-allow-origin', config.allowOrigin);
  reply.header('access-control-allow-headers', 'content-type');
  reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
  return payload;
});
app.options('/*', async (_req, reply) => reply.code(204).send());

app.get('/api/health', async () => ({
  ok: true,
  omniFlashKeyPresent: Boolean(config.googleApiKey),
  model: config.omniFlashModel,
}));

/** Resolution for v1: Omni Flash is used at 720p (PRD P0.3 note). */
const RES = '720p' as const;

interface GenerateBody {
  brief: Brief;
  parts: PromptPart[];
  confirmedCostInr?: number;
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
  if (!config.googleApiKey) {
    return reply.code(503).send({ code: 'omni-flash-not-configured', message: 'GOOGLE_API_KEY is not set on the server.' });
  }

  const cost = estimateCost(brief, { usdPerSecond: config.usdPerSecond });
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

  // References: only usable once attachments carry a fetchable URL. Inert today.
  const references: OmniRef[] = (brief.attachments ?? [])
    .filter((a) => (a as { url?: string }).url)
    .map((a) => ({ uri: (a as { url?: string }).url, mimeType: 'image/jpeg', kind: 'image' as const }));

  let previousInteractionId: string | undefined;
  try {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isFirst = i === 0;
      const clip = await generateClip(
        {
          prompt: part.text,
          aspect: brief.aspect,
          resolution: RES,
          references: isFirst && references.length ? references : undefined,
          previousInteractionId: isFirst ? undefined : previousInteractionId,
          task: isFirst ? (references.length ? 'reference_to_video' : 'text_to_video') : 'extend',
        },
        config.googleApiKey,
      );
      previousInteractionId = clip.interactionId;

      let bytes: Buffer;
      let mime = clip.mimeType;
      if (clip.base64) {
        bytes = Buffer.from(clip.base64, 'base64');
      } else if (clip.fileId) {
        const dl = await downloadFile(clip.fileId, config.googleApiKey);
        bytes = dl.bytes;
        mime = dl.mimeType;
      } else {
        throw new OmniFlashError('omni-flash-no-video', 'Clip had neither base64 nor a file id.');
      }

      const storagePath = await uploadClip(jobId, part.partNum, bytes, mime);
      clips[i] = { ...clips[i]!, interactionId: clip.interactionId, storagePath, status: 'done' };
      await updateJob(jobId, { clips });
    }

    await updateJob(jobId, { status: 'done', clips });
    return { jobId, status: 'done', cost, clips: clipsForClient(jobId, clips) };
  } catch (err) {
    const e = err as OmniFlashError;
    const failedIdx = clips.findIndex((c) => c.status === 'pending');
    if (failedIdx >= 0) clips[failedIdx] = { ...clips[failedIdx]!, status: 'failed', error: e.message };
    await updateJob(jobId, { status: 'failed', error: e.message, clips }).catch(() => {});
    return reply.code(e instanceof OmniFlashError ? e.status : 502).send({
      code: e.code ?? 'generate-failed',
      message: e.message,
      jobId,
      clips: clipsForClient(jobId, clips),
    });
  }
});

app.get<{ Params: { jobId: string } }>('/api/generate/:jobId', async (req, reply) => {
  const job = await getJob(req.params.jobId);
  if (!job) return reply.code(404).send({ code: 'not-found', message: 'No such job' });
  return { ...job, clips: clipsForClient(job.jobId, job.clips) };
});

app.get<{ Params: { jobId: string; part: string } }>('/api/clips/:jobId/:part', async (req, reply) => {
  const job = await getJob(req.params.jobId);
  const clip = job?.clips.find((c) => String(c.partNum) === req.params.part);
  if (!clip || !clip.storagePath) return reply.code(404).send({ code: 'not-found', message: 'No such clip' });
  const s = await streamClip(clip.storagePath);
  if (!s) return reply.code(404).send({ code: 'not-found', message: 'Clip missing from storage' });
  reply.header('content-type', s.contentType);
  reply.header('accept-ranges', 'bytes');
  if (s.size) reply.header('content-length', String(s.size));
  return reply.send(s.stream);
});

function clipsForClient(jobId: string, clips: JobClip[]) {
  return clips.map((c) => ({
    partNum: c.partNum,
    totalParts: c.totalParts,
    seconds: c.seconds,
    start: c.start,
    end: c.end,
    status: c.status,
    error: c.error,
    url: c.status === 'done' ? `/api/clips/${jobId}/${c.partNum}` : null,
  }));
}

/** P0.2 — car-model reference scraper trigger. Still delegated to jobs/scraper. */
app.post<{ Body: { models: string[] } }>('/api/scrape', async (req, reply) => {
  const models = req.body?.models ?? [];
  if (!models.length) return reply.code(400).send({ code: 'bad-request', message: 'models[] required' });
  return reply.code(501).send({
    code: 'scraper-not-implemented',
    message: 'Trigger jobs/scraper as a Cloud Run job execution — not yet wired from the API.',
    models,
  });
});

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then((addr) => app.log.info(`api listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
