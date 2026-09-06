import Fastify from 'fastify';
import { isPromptOnly, estimateCost, type Brief, type PromptPart } from '@ava/shared';
import { loadConfig } from './config.js';
import { generate as omniGenerate, OmniFlashNotConfiguredError } from './omniFlash.js';

const config = loadConfig();
const app = Fastify({ logger: true });

app.addHook('onSend', async (_req, reply) => {
  reply.header('access-control-allow-origin', config.allowOrigin);
  reply.header('access-control-allow-headers', 'content-type');
  reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
});
app.options('/*', async (_req, reply) => reply.code(204).send());

app.get('/api/health', async () => ({
  ok: true,
  omniFlashKeyPresent: Boolean(config.googleApiKey),
  model: config.omniFlashModel,
}));

/**
 * P0.1 — accept a finished master prompt + reference images and call Omni Flash.
 * Currently returns 501; pre-flight and cost gating already happen client-side
 * and are re-checked here before any spend.
 */
app.post<{ Body: { brief: Brief; parts: PromptPart[]; confirmedCostInr?: number } }>(
  '/api/generate',
  async (req, reply) => {
    const { brief, parts, confirmedCostInr } = req.body ?? {};
    if (!brief || !Array.isArray(parts) || parts.length === 0) {
      return reply.code(400).send({ code: 'bad-request', message: 'brief and parts are required' });
    }
    if (isPromptOnly(brief.categories)) {
      return reply
        .code(422)
        .send({ code: 'prompt-only', message: 'This brief includes a presenter category — it is prompt-only, no API call.' });
    }

    const cost = estimateCost(brief, { usdPerSecond: config.usdPerSecond });
    if (cost.needsConfirmation && (confirmedCostInr ?? 0) < cost.inr) {
      return reply.code(428).send({
        code: 'cost-confirmation-required',
        message: `Estimated ₹${cost.inr} exceeds the ₹500 threshold — resubmit with confirmedCostInr.`,
        cost,
      });
    }

    try {
      const clips = await omniGenerate(
        { parts, referenceImages: (brief.attachments ?? []).map((a) => a.filename), aspect: brief.aspect },
        config.googleApiKey,
      );
      return { ok: true, clips, cost };
    } catch (err) {
      const e = err as { code?: string; message: string };
      const status = e instanceof OmniFlashNotConfiguredError ? 503 : 501;
      return reply.code(status).send({ code: e.code ?? 'error', message: e.message });
    }
  },
);

/**
 * P0.2 — trigger the car-model reference scraper for an explicit model list.
 * Delegates to jobs/scraper (a Cloud Run job); stubbed here.
 */
app.post<{ Body: { models: string[] } }>('/api/scrape', async (req, reply) => {
  const models = req.body?.models ?? [];
  if (!models.length) return reply.code(400).send({ code: 'bad-request', message: 'models[] required' });
  return reply.code(501).send({
    code: 'scraper-not-implemented',
    message: 'The cardekho.com scraper is stubbed. Run the Phase 1 scrapability spike, then wire jobs/scraper.',
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
