import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { getFirestore } from 'firebase-admin/firestore';
import { listUsageFacts } from './spendLog.js';
import Fastify from 'fastify';
import { pieceBounds, overlayTheme, LOGO_CLEAN_VERSION, logoLayout,
  brandMatches,
  isPromptOnly,
  estimateCost,
  estimateSegmentsCost,
  renderCost,
  VIDEO_PRICES,
  applyFeedback,
  overlayCopy,
  buildPrompt,
  overlayCards,
  categoryValues,
  fieldLabel,
  colourName,
  renderResolution,
  priceFor,
  shortSideFor,
  sceneCard,
  sceneVisual,
  narrationMode,
  VEO_31_DEFAULTS,
  VEO_31_FAST_DEFAULTS,
  VEO_31_LITE_DEFAULTS,
  OMNI_FLASH_LEGACY_DEFAULTS,
  validateEditProject,
  EDIT_MAIN_TRACK,
  type EditProject,
  type EditSource,
  DAILY_LIMITS,
  nextPacificMidnight,
  resetTimeLabel,
  type SceneOverride,
  type Resolution,
  type Brief,
  type PromptPart,
  type ScenePlan,
  type DealerPhoto,
  type CarAngle,
  type CarModelProfile,
  type StoredImage,
} from '@ava/shared';
import { loadConfig } from './config.js';
import { generateClip, downloadFile, fetchInteractionVideo, OmniFlashError, type OmniRef } from './omniFlash.js';
import {
  generateSeedanceClip,
  enhanceSeedanceClip,
  testSeedanceKey,
  SeedanceError,
  type SeedanceRef,
} from './seedance.js';
import { generateVeoClip, VeoError } from './veo.js';
import { countRequest, markExhausted, usageToday } from './usage.js';
import { renderEditProject } from './editRender.js';
import { editOpenPlan, segmentsKept, type EditOpenPlan } from './editOpen.js';
import { drawLayer, fitReplacementLogo, type DrawnLayer } from './layerDraw.js';
import { importWebsite } from './siteImport.js';
import { drawActorSheet, fillActorProfile } from './actorProfile.js';
import { cleanLogo, findBrandLogo } from './logos.js';
import { checkVehicleFrame } from './vehicleCheck.js';
import { listRunFacts, listAllJobs,
  saveJob,
  updateJob,
  getJob,
  uploadClip,
  uploadCleanCut,
  streamClip,
  putRef,
  readObject,
  signedUrlFor,
  listJobsForProject,
  listRecentJobs,
  safeRefName,
  type JobRecord,
  type JobClip,
  listAllJobDocs,
} from './store.js';
import { scrapeModel, getCarModel } from './scraper.js';
import { sceneCuts, cutVideo, conformLength, withSoundOf,
  composeFinal,
  composeClean,
  contactSheet,
  joinVideos,
  keepRanges,
  lastFrame,
  posterFrame,
  selfTest,
  trimClip,
  upscaleVideo,
  videoFacts,
  filmSpeech,
  measureLoudness,
  type BrandOverlay,
  type ComposedLayers,
} from './post.js';
import { bearer } from './auth.js';
import {
  resolveIdToken,
  looksLikeIdToken,
  listUsers,
  setUserRole,
  removeUser,
  recordActivity,
  listActivity,
  uncountRun, setRunTotals,
  allows,
  PREVIEW_UID,
  type Caller,
} from './users.js';
import { listAll, getOne, upsert, patch, patchTotals, remove, type Collection } from './library.js';
import { writeScript, ScriptError, type ScriptScene, type ScriptLanguage } from './script.js';
import { generateMusicBed } from './lyria.js';
import {
  buildContext,
  buildBeats,
  planScenes,
  CATEGORY_BY_ID,
  BRAND_CATALOGUE,
  LANGUAGE_SEEDS,
  OMNI_FLASH_DEFAULTS,
  SEEDANCE_25_DEFAULTS,
  SEEDANCE_20_FAST_DEFAULTS,
  type ProviderKind,
  type Role,
  type VehicleKind,
  type VehicleDataSource,
  speakingSeconds,
  wordBudget,
  sceneEditFor,
  DEFAULT_USD_TO_INR,
  clampPace,
  storyGuidance,
  storyTheme,
  themeDirection,
  plainSpoken,
  orderReferences,
  type ClientProfile,
  DEALER_VIEWS,
  type DealerView,
  type FilmLayers,
  type FilmLogoLayer,
  type FilmMusicLayer,
  type SpeechSpan,
  editWithFilmMusicLine,
  validateEditLayer,
  validateEditLook,
  type EditLayer,
  type EditLook,
} from '@ava/shared';
import { syncVehicleModel, listBrandModels, title, syncColours } from './carSync.js';
import { seePhotos, seeDealerPhotos, findPeople } from './vision.js';
import {
  drawSceneFrame,
  sceneImageContext,
  SceneImageError,
  type SceneImageRef,
} from './sceneImage.js';
import { syncOemModel, OemSyncError } from './oemSync.js';
import { syncGoogleModel } from './googleSync.js';
import { planFromBrief, PlanError, type PlanContext } from './planBrief.js';
import { importPlace, PlacesError } from './places.js';
import { putCredentialKey, getCredentialKey, deleteCredentialKey } from './credentials.js';

const config = loadConfig();
// Reference videos arrive base64 in JSON, so the ceiling is a reference video's
// worth of it rather than an image's.
const app = Fastify({ logger: true, bodyLimit: 70 * 1024 * 1024 });

// A request can say it carries JSON and still have no body — every DELETE from the web
// app did, and Fastify turned each one away with a 400 before it reached its route, so
// nothing could be deleted. An empty JSON body now just means no body; anything else
// still goes through Fastify's own parser and its prototype-poisoning checks.
const jsonParser = app.getDefaultJsonParser('error', 'error');
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (!String(body).trim()) return done(null, undefined);
  jsonParser(req, String(body), done);
});

/**
 * Which pages may read the API's replies: the live site, and this project's
 * Firebase preview channels (ai-video-app-cd--<channel>.web.app). A preview link
 * is a different origin; answering it with the live one made the browser discard
 * every reply, so signing in on a preview silently did nothing. This decides who
 * may READ a reply, not who may call — sign-in still decides that.
 */
const previewSite = (() => {
  try {
    const host = new URL(config.allowOrigin).hostname;
    if (!host.endsWith('.web.app')) return null;
    const site = host.slice(0, -'.web.app'.length).replace(/[^a-z0-9-]/gi, '');
    return new RegExp('^https://' + site + '--[a-z0-9-]+\\.web\\.app$');
  } catch {
    return null;
  }
})();
const corsOrigin = (origin: string | undefined): string =>
  config.allowOrigin !== '*' && origin && (origin === config.allowOrigin || previewSite?.test(origin))
    ? origin
    : config.allowOrigin;

app.addHook('onSend', async (req, reply, payload) => {
  reply.header('access-control-allow-origin', corsOrigin(req.headers.origin));
  reply.header('vary', 'Origin');
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

/**
 * A preview that opens without signing in, when asked for. Honoured only while
 * all three hold: the request arrived on the preview tag's own address
 * (preview---…), so the live address can never reach it however a revision is
 * configured; PREVIEW_OPEN_UNTIL is set on that revision; and that moment has not
 * passed. The visitor is a creator — generate, edit the libraries — and never an
 * admin, so API keys, people and the audit log stay out of reach.
 */
const PREVIEW_CALLER: Caller = {
  uid: PREVIEW_UID,
  email: 'preview@no-sign-in',
  name: 'Preview (no sign-in)',
  role: 'creator',
  isOwner: false,
};
const previewOpen = (host: string | undefined): boolean =>
  Number(process.env.PREVIEW_OPEN_UNTIL ?? 0) > Date.now() && String(host ?? '').startsWith('preview---');

declare module 'fastify' {
  interface FastifyRequest {
    caller?: Caller;
  }
}

/**
 * Routes that spend money or expose secrets, and the role each needs. Anything
 * not listed is readable by any signed-in person: the libraries and finished
 * videos are safe to look at, and looking is what a viewer is for.
 */
function requiredRole(method: string, url: string): Role | null {
  // API credentials and roles are the keys to the kingdom — admin only.
  if (url.startsWith('/api/credentials') || url.startsWith('/api/users')) return 'admin';
  if (url.startsWith('/api/activity')) return 'admin';
  // Revenue, cost and margin by dealer: admin only.
  if (url.startsWith('/api/analytics')) return 'admin';
  // Hiding a run changes what the team is told it has spent: admin only.
  if (/^\/api\/generations\/[^/]+\/hide$/.test(url)) return 'admin';
  if (url.startsWith('/api/brands') && method !== 'GET') return 'creator';
  if (url.startsWith('/api/models/seed')) return 'admin';
  if (url.startsWith('/api/models') && method !== 'GET') return 'admin';
  // Opening a film as layers, and drawing a layer's picture: viewers try the editor too.
  // Checked inside: a viewer only opens layers that are already prepared.
  if (/^\/api\/generations\/[^/]+\/layers$/.test(url) || url === '/api/edits/layer') return null;

  // Everything that costs money, or changes what a paid run will produce.
  if (
    url.startsWith('/api/generate') ||
    url.startsWith('/api/script') ||
    url.startsWith('/api/scrape') ||
    url.startsWith('/api/refs') ||
    url.startsWith('/api/cars/sync') ||
    url.startsWith('/api/clients/gmb')
  ) {
    return method === 'GET' ? null : 'creator';
  }

  // Library records: read freely, change only as a creator.
  if (method !== 'GET' && method !== 'HEAD') return 'creator';
  return null;
}

app.addHook('preHandler', async (req, reply) => {
  if (req.method === 'OPTIONS') return;
  const url = (req.raw.url ?? '').split('?')[0] ?? '';
  if (!url.startsWith('/api/')) return;
  if (url === '/api/health') return;
  // Clips and reference images are fetched by <video>/<img>, which cannot send
  // an Authorization header. They are unguessable UUID paths.
  if (url.startsWith('/api/clips/') || url.startsWith('/api/refs/')) return;

  // Identify the caller FIRST, for every guarded route and for /api/session.
  // Session is open — it is how the browser asks "am I signed in?" — but it
  // still needs the answer, so resolution has to happen before that exemption.
  // Google only. A shared password can tell you that something happened but
  // never who did it, and every paid action here has to be attributable.
  const token = bearer(req.headers.authorization);
  if (token && looksLikeIdToken(token)) {
    const caller = await resolveIdToken(token);
    if (caller) req.caller = caller;
  }
  // No signed-in person: a sign-in-free preview may stand in (see previewOpen).
  if (!req.caller && previewOpen(req.headers.host)) req.caller = PREVIEW_CALLER;

  if (OPEN_PATHS.has(url)) return;
  if (!req.caller) {
    return reply.code(401).send({ code: 'unauthorized', message: 'Sign in to use this app.' });
  }

  const needed = requiredRole(req.method, url);
  if (needed && !allows(req.caller ?? null, needed)) {
    return reply.code(403).send({
      code: 'forbidden',
      message:
        needed === 'admin'
          ? 'Only an admin can see analytics or change API connections, models and roles.'
          : 'Your account can view this app but not generate videos or change the libraries. Ask an admin for creator access.',
      role: req.caller?.role,
      needed,
    });
  }
});

/** Who am I, and what may I do? The client shapes itself around this. */
app.get('/api/session', async (req) => ({
  authEnabled: true,
  signedIn: Boolean(req.caller),
  previewOpen: req.caller?.uid === PREVIEW_UID,
  user: req.caller
    ? {
        id: req.caller.uid,
        email: req.caller.email,
        name: req.caller.name,
        photo: req.caller.photo,
        role: req.caller.role,
        isOwner: req.caller.isOwner,
      }
    : null,
}));

/* ---- actors made from a description ---- */

type ActorInput = Partial<import('@ava/shared').ActorProfile>;

/** Fill an actor's profile in from a sentence describing them. Nothing is saved: the editor decides. */
app.post<{ Body: { description?: string; current?: ActorInput } }>('/api/actor-profile/fill', async (req, reply) => {
  const description = (req.body?.description ?? '').trim().slice(0, 2000);
  if (!description) return reply.code(400).send({ code: 'actor-no-description', message: 'Describe the presenter first.' });
  const apiKey = await scriptKey();
  if (!apiKey) {
    return reply.code(503).send({ code: 'script-no-key', message: 'Filling in a profile needs a Google Gemini key. Add one in APIs & models.' });
  }
  try {
    return await fillActorProfile(description, req.body?.current ?? {}, apiKey);
  } catch (err) {
    const e = err as { code?: string; message?: string; status?: number };
    return reply.code(e.status ?? 502).send({ code: e.code ?? 'actor-fill-failed', message: e.message ?? 'Could not fill the profile in.' });
  }
});

/**
 * Draw an actor's profile sheet and store it, ready to become the reference photo.
 * With `keepFace`, the photo the actor already has goes along, so a redraw is the
 * same person rather than a new one.
 */
app.post<{ Body: { actor?: ActorInput; setting?: string; keepFace?: boolean } }>('/api/actor-profile/draw', async (req, reply) => {
  const actor = req.body?.actor;
  if (!actor) return reply.code(400).send({ code: 'actor-missing', message: 'No actor to draw.' });
  const apiKey = await scriptKey();
  if (!apiKey) {
    return reply.code(503).send({ code: 'script-no-key', message: 'Drawing a profile needs a Google Gemini key. Add one in APIs & models.' });
  }
  let face: { data: string; mimeType: string } | undefined;
  if (req.body?.keepFace && actor.photo?.storagePath) {
    const obj = await readObject(actor.photo.storagePath).catch(() => null);
    if (obj) face = { data: obj.bytes.toString('base64'), mimeType: obj.contentType || 'image/png' };
  }
  try {
    const drawn = await drawActorSheet(
      {
        name: actor.name ?? '',
        gender: actor.gender === 'male' ? 'male' : 'female',
        age: actor.age,
        ageBand: actor.ageBand,
        attire: actor.attire,
        style: actor.style,
        voice: actor.voice,
        personality: actor.personality,
        traits: actor.traits?.map((t) => t.trim()).filter(Boolean),
      },
      { setting: req.body?.setting, face },
      apiKey,
    );
    const ext = drawn.mimeType.includes('png') ? 'png' : drawn.mimeType.includes('webp') ? 'webp' : 'jpg';
    const stem = ((actor.name ?? '').split(/\s+[—–-]\s+|\s*\(/)[0] ?? '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'actor';
    const { refId, storagePath } = await putRef(`${stem}-profile-${Date.now().toString(36)}.${ext}`, drawn.mimeType, drawn.bytes);
    return {
      photo: {
        refId,
        storagePath,
        filename: storagePath.split('/').pop() ?? `${stem}.${ext}`,
        label: `${actor.name || 'Actor'} — profile sheet`,
      },
      model: drawn.model,
    };
  } catch (err) {
    const e = err as { code?: string; message?: string; status?: number };
    return reply.code(e.status ?? 502).send({ code: e.code ?? 'actor-draw-failed', message: e.message ?? 'Could not draw the profile sheet.' });
  }
});

/* ---- analytics (admin only, enforced in the preHandler) ---- */

/** The runs behind every campaign's cost. Projects and clients the app already has. */
app.get('/api/analytics/runs', async () => ({ items: await listRunFacts() }));
app.get('/api/analytics/usage', async () => ({ items: await listUsageFacts() }));

/**
 * Every run's cost worked out again from what it rendered, at today's prices.
 *
 * Runs were billed at one flat rate whatever the resolution, for the seconds planned
 * rather than the seconds rendered, and without the parts made again for the wrong
 * vehicle. This reprices each from its own record. Nothing changes unless `apply` is
 * set; applied, each run keeps its old figure beside the new one, and every project's
 * and person's totals are set again from their runs, hidden runs left out.
 */
app.post<{ Body: { apply?: boolean } }>('/api/analytics/reprice', async (req) => {
  const apply = req.body?.apply === true;
  const [jobs, models] = await Promise.all([listAllJobs(), listAll<Record<string, any>>('models')]);
  const byModel = new Map<string, { model: string; runs: number; beforeInr: number; afterInr: number }>();
  const changed: { job: JobRecord; inr: number; usd: number }[] = [];
  let beforeInr = 0;
  let afterInr = 0;
  const isAttempt = (j: JobRecord): boolean => !j.kind || j.kind === 'generate' || j.kind === 'retake';

  for (const j of jobs) {
    const before = Math.round(j.costInr ?? 0);
    let inr = before;
    let usd = j.costUsd ?? 0;
    const done = (j.clips ?? []).filter((c) => c.status === 'done');
    // A run with no model on record — the earliest ones — cannot be priced again, so it keeps its figure.
    if (isAttempt(j) && done.length && j.modelId) {
      const model = models.find((m) => m.modelId === j.modelId);
      const render = renderResolution(j.modelId ?? '', (j.resolution ?? '720p') as Resolution, model?.resolutions).render;
      const rate =
        VIDEO_PRICES[j.modelId ?? '']?.[render] ??
        (model ? priceFor(model as Parameters<typeof priceFor>[0], (j.resolution ?? '720p') as Resolution) : undefined) ??
        j.usdPerSecond ??
        config.usdPerSecond;
      const remade = new Set((j.vehicleChecks ?? []).filter((v) => v.remade).map((v) => v.part));
      const billed = renderCost(
        j.modelId,
        rate,
        done
          .filter((c) => !c.reused)
          .map((c) => ({
            seconds: c.seconds,
            remade: c.remade || remade.has(c.partNum),
            images: c.images ?? j.referenceFiles?.find((r) => r.part === c.partNum)?.files.length,
            promptChars: j.prompts?.find((p) => p.part === c.partNum)?.text.length,
          })),
        { resolution: render },
      );
      inr = billed.inr;
      usd = billed.usd;
    }
    if (!j.hidden) {
      beforeInr += before;
      afterInr += inr;
    }
    const key = j.modelName || j.modelId || 'Unknown model';
    const row = byModel.get(key) ?? { model: key, runs: 0, beforeInr: 0, afterInr: 0 };
    row.runs += 1;
    row.beforeInr += before;
    row.afterInr += inr;
    byModel.set(key, row);
    if (inr !== before) changed.push({ job: j, inr, usd });
  }

  let projectsSet = 0;
  let peopleSet = 0;
  if (apply) {
    for (const c of changed) {
      await updateJob(c.job.jobId, {
        costInr: c.inr,
        costUsd: c.usd,
        costInrBefore: c.job.costInrBefore ?? Math.round(c.job.costInr ?? 0),
      });
    }
    const repriced = new Map(changed.map((c) => [c.job.jobId, c.inr]));
    const costOf = (j: JobRecord): number => repriced.get(j.jobId) ?? Math.round(j.costInr ?? 0);
    const counted = jobs.filter((j) => !j.hidden);
    for (const p of await listAll<Record<string, any>>('projects')) {
      const mine = counted.filter((j) => j.projectId === p.id);
      const total = mine.reduce((a, j) => a + costOf(j), 0);
      const runs = mine.filter(isAttempt).length;
      if ((p.totalCostInr ?? 0) === total && (p.generationCount ?? 0) === runs) continue;
      await patchTotals('projects', p.id, { totalCostInr: total, generationCount: runs });
      projectsSet += 1;
    }
    const byUser = new Map<string, { spend: number; runs: number }>();
    for (const j of counted) {
      if (!j.userId) continue;
      const u = byUser.get(j.userId) ?? { spend: 0, runs: 0 };
      u.spend += costOf(j);
      if (isAttempt(j)) u.runs += 1;
      byUser.set(j.userId, u);
    }
    for (const [uid, t] of byUser) if (await setRunTotals(uid, t.spend, t.runs).catch(() => false)) peopleSet += 1;
  }

  return {
    applied: apply,
    runs: jobs.length,
    changed: changed.length,
    beforeInr,
    afterInr,
    projectsSet,
    peopleSet,
    byModel: [...byModel.values()].sort((a, b) => b.afterInr - a.afterInr),
  };
});

/* ---- user administration (admin only, enforced in the preHandler) ---- */

app.get('/api/users', async () => ({ items: await listUsers() }));

/** The audit trail: who signed in, who generated what, and what it cost. */
app.get<{ Querystring: { uid?: string; limit?: string } }>('/api/activity', async (req) => ({
  items: await listActivity(Math.min(500, Number(req.query?.limit ?? 200) || 200), req.query?.uid),
}));

app.patch<{ Params: { id: string }; Body: { role?: Role } }>('/api/users/:id', async (req, reply) => {
  const role = req.body?.role;
  if (role !== 'viewer' && role !== 'creator' && role !== 'admin') {
    return reply.code(400).send({ code: 'bad-request', message: 'role must be viewer, creator or admin' });
  }
  const updated = await setUserRole(req.params.id, role);
  if (!updated) return reply.code(404).send({ code: 'not-found', message: 'No such user' });
  return updated;
});

app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
  if (req.params.id === req.caller?.uid) {
    return reply.code(400).send({ code: 'bad-request', message: 'You cannot remove your own account.' });
  }
  const ok = await removeUser(req.params.id);
  if (!ok) return reply.code(400).send({ code: 'owner-protected', message: 'The owner account cannot be removed.' });
  return { ok: true };
});


/* ============================ library CRUD ============================ */

const COLLECTIONS: Collection[] = [
  'actors',
  'cars',
  'clients',
  'instructions',
  'languages',
  'projects',
  'credentials',
  'models',
];

/**
 * What a viewer is shown of a library record, or null for none of it.
 *
 * A viewer is somebody exploring the app. They see the work — the projects, dealers,
 * vehicles and presenters — but not what a film cost or earned, and not the house
 * rules and pronunciation guides the films are made with: those are how the product
 * works, and a viewer account is the easiest one to be given.
 */
function forViewer(name: Collection, doc: Record<string, unknown>): Record<string, unknown> | null {
  const out = { ...doc };
  switch (name) {
    case 'instructions':
    case 'credentials':
      return null;
    case 'languages':
      out.spokenGuide = '';
      out.writtenGuide = '';
      out.glossary = [];
      return out;
    case 'projects':
      delete out.totalCostInr;
      delete out.campaignRevenueInr;
      return out;
    case 'models':
      delete out.usdPerSecond;
      delete out.usdPerSecondByResolution;
      return out;
    default:
      return out;
  }
}

/** What a creator is shown: everything a viewer is, and more — but not what a film cost, which is for admins. */
function forCreator(name: Collection, doc: Record<string, unknown>): Record<string, unknown> | null {
  if (name !== 'projects') return doc;
  const out = { ...doc };
  delete out.totalCostInr;
  return out;
}

const VIEWER_BLOCKED = { code: 'forbidden', message: 'This section is not available for viewer access.' };

for (const name of COLLECTIONS) {
  app.get(`/api/${name}`, async (req) => {
    const items = await listAll<Record<string, unknown>>(name);
    if (allows(req.caller ?? null, 'admin')) return { items };
    const shown = allows(req.caller ?? null, 'creator') ? forCreator : forViewer;
    return { items: items.map((d) => shown(name, d)).filter((d): d is Record<string, unknown> => d !== null) };
  });

  app.get<{ Params: { id: string } }>(`/api/${name}/:id`, async (req, reply) => {
    const doc = await getOne<Record<string, unknown>>(name, req.params.id);
    if (!doc) return reply.code(404).send({ code: 'not-found', message: `No such ${name} record` });
    if (allows(req.caller ?? null, 'admin')) return doc;
    const shown = (allows(req.caller ?? null, 'creator') ? forCreator : forViewer)(name, doc);
    return shown ?? reply.code(403).send(VIEWER_BLOCKED);
  });

  app.post<{ Body: Record<string, unknown> }>(`/api/${name}`, async (req, reply) => {
    if (!req.body || typeof req.body !== 'object') {
      return reply.code(400).send({ code: 'bad-request', message: 'Body required' });
    }
    let body = req.body;
    // A new record arrives with a blank id, and upsert makes it one — there is nothing
    // stored to look up, and Firestore refuses a blank document path outright.
    const existingId = typeof body.id === 'string' && body.id.trim() ? body.id : undefined;
    if (name === 'credentials' && existingId) {
      // Whether a connection has a key is the server's to say. A page opened before the
      // key was saved still holds the old answer, and saving the name would put it back.
      const prior = await getOne<Record<string, unknown>>('credentials', existingId);
      if (prior) {
        body = { ...body };
        for (const k of ['hasKey', 'usesEnvKey'] as const) {
          if (prior[k] === undefined) delete body[k];
          else body[k] = prior[k];
        }
      }
    }
    if (name === 'projects' && existingId) {
      // What a project has cost is a running total the server keeps. The editor saves
      // the whole project, and a copy loaded before the last run finished — or a
      // creator's, who is never sent the total — would write the old figure back over it.
      const prior = await getOne<Record<string, unknown>>('projects', existingId);
      if (prior) body = { ...body, totalCostInr: prior.totalCostInr, generationCount: prior.generationCount };
    }
    return await upsert(name, body);
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
    const cred = await getOne<{ id: string; provider?: string }>('credentials', req.params.id);
    if (!cred) return reply.code(404).send({ code: 'not-found', message: 'No such credential' });
    await putCredentialKey(req.params.id, key);
    // A Gemini connection with a key of its own stops using the service's GOOGLE_API_KEY.
    const gemini = cred.provider === 'google-gemini';
    await patch('credentials', req.params.id, { hasKey: true, ...(gemini ? { usesEnvKey: false } : {}) });
    return { ok: true, hasKey: true, usesEnvKey: gemini ? false : undefined };
  },
);

app.delete<{ Params: { id: string } }>('/api/credentials/:id/key', async (req) => {
  const cred = await getOne<{ id: string; provider?: string }>('credentials', req.params.id);
  await deleteCredentialKey(req.params.id);
  // Without a key of its own, a Gemini connection goes back to the service's GOOGLE_API_KEY.
  const gemini = cred?.provider === 'google-gemini';
  await patch('credentials', req.params.id, { hasKey: false, ...(gemini ? { usesEnvKey: true } : {}) });
  return { ok: true, hasKey: false, usesEnvKey: gemini ? true : undefined };
});

/**
 * Turn the storyboard's stage directions into lines the presenter actually says.
 *
 * This is the fix for mangled Hindi: without it the video model is handed an
 * English instruction ("open with a sincere greeting") and has to compose the
 * Hindi, pronounce it and lip-sync to it all at once. Text generation costs a
 * fraction of a rupee, so the script is written and approved before any paid
 * video call.
 */
/** The language's rules, resolved from the library for a script pass. */
/**
 * Languages seeded before plain spellings still teach stress capitals and syllable
 * hyphens, which the video model spelled out letter by letter. A guide that still has
 * that section is brought up to the current seed: its guide, and every locked spelling
 * the seed also has. A spelling the team added keeps its word, in plain letters.
 */
const OLD_STRESS_RULE = 'CAPS on the stressed syllable';
function upgradeLanguage(stored: Record<string, any>): Record<string, any> | null {
  const seed = LANGUAGE_SEEDS.find((s) => s.code === stored.code);
  if (!seed || !String(stored.spokenGuide ?? '').includes(OLD_STRESS_RULE)) return null;
  const seeded = new Map(seed.glossary.map((g) => [g.term, g.say]));
  const glossary = (Array.isArray(stored.glossary) ? stored.glossary : []).map((g: Record<string, any>) => ({
    ...g,
    say: seeded.get(g.term) ?? plainSpoken(String(g.say ?? '')),
  }));
  return { ...stored, spokenGuide: seed.spokenGuide, glossary };
}

async function upgradeStoredLanguages(): Promise<void> {
  for (const lang of await listAll<Record<string, any>>('languages')) {
    const next = upgradeLanguage(lang);
    if (!next) continue;
    await patch('languages', lang.id, { spokenGuide: next.spokenGuide, glossary: next.glossary });
    app.log.info({ language: lang.name }, 'language guide moved to plain spellings');
  }
}
upgradeStoredLanguages().catch((e) => app.log.warn({ err: (e as Error).message }, 'language upgrade failed'));

/**
 * Built-in languages an install does not have yet, added on start. Each is added once:
 * the codes offered are noted, so a language somebody deleted is not put back, and the
 * languages an install already had count as offered.
 */
async function addNewBuiltInLanguages(): Promise<void> {
  const stored = await listAll<Record<string, any>>('languages');
  const note = getFirestore().collection('meta').doc('languageSeeds');
  const offered = new Set<string>([
    ...(((await note.get()).data()?.codes as string[] | undefined) ?? []),
    ...stored.map((l) => String(l.code ?? '').trim().toLowerCase()),
  ]);
  const added: string[] = [];
  for (const seed of LANGUAGE_SEEDS) {
    if (offered.has(seed.code)) continue;
    await upsert('languages', seed);
    offered.add(seed.code);
    added.push(seed.name);
  }
  await note.set({ codes: [...offered].filter(Boolean), updatedAt: Date.now() }, { merge: true });
  if (added.length) app.log.info({ added }, 'built-in languages added');
}
addNewBuiltInLanguages().catch((e) => app.log.warn({ err: (e as Error).message }, 'adding built-in languages failed'));

/**
 * Bring an existing install's models up to date, on every start.
 *
 * Additive, like the seed: a model already registered is never replaced, and a
 * daily limit already set — by hand or otherwise — is never written over. What it
 * adds is the earlier Omni and Veo 3.1 Lite, and the known daily limits on models
 * saved before limits existed. A fresh install has no Gemini connection yet and is
 * left to the seed route.
 */
/** The prices built-in models were first saved with, so a price somebody edited is never overwritten. */
const SEEDED_PRICES: Record<string, { usdPerSecond: number; byRes?: Record<string, number> }> = {
  'gemini-omni-1.1-flash': { usdPerSecond: 0.1 },
  'gemini-omni-flash': { usdPerSecond: 0.1 },
  'veo-3.1-generate-preview': { usdPerSecond: 0.4, byRes: { '720p': 0.4, '1080p': 0.4 } },
  'veo-3.1-fast-generate-preview': { usdPerSecond: 0.1, byRes: { '720p': 0.1, '1080p': 0.12 } },
  'veo-3.1-lite-generate-preview': { usdPerSecond: 0.05, byRes: { '720p': 0.05, '1080p': 0.08 } },
};

const sameRates = (a: Record<string, unknown> | undefined, b: Record<string, number> | undefined): boolean => {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  return ka.length === kb.length && kb.every((k) => Number((a ?? {})[k]) === b![k]);
};

async function ensureBuiltInModels(): Promise<string[]> {
  const done: string[] = [];
  const [models, creds] = await Promise.all([
    listAll<Record<string, any>>('models'),
    listAll<Record<string, any>>('credentials'),
  ]);
  const gemini = creds.find((c) => c.provider === 'google-gemini');
  if (!gemini) return done;
  for (const d of [OMNI_FLASH_LEGACY_DEFAULTS, VEO_31_LITE_DEFAULTS]) {
    if (models.some((m) => m.modelId === d.modelId)) continue;
    await upsert('models', { ...d, credentialId: gemini.id });
    done.push(d.name);
  }
  for (const m of models) {
    const limit = DAILY_LIMITS[String(m.modelId)];
    if (!limit || m.dailyRequestLimit != null) continue;
    await patch('models', m.id, { dailyRequestLimit: limit });
    done.push(`${m.name}: ${limit} requests a day`);
  }
  for (const m of models) {
    const prices = VIDEO_PRICES[String(m.modelId)];
    const seeded = SEEDED_PRICES[String(m.modelId)];
    if (!prices || !seeded) continue;
    if (Number(m.usdPerSecond) !== seeded.usdPerSecond || !sameRates(m.usdPerSecondByResolution, seeded.byRes)) continue;
    await patch('models', m.id, { usdPerSecond: prices['720p'] ?? m.usdPerSecond, usdPerSecondByResolution: prices });
    done.push(`${m.name}: priced by resolution`);
  }
  return done;
}
ensureBuiltInModels()
  .then((done) => {
    if (done.length) app.log.info({ done }, 'built-in models brought up to date');
  })
  .catch((e) => app.log.warn({ err: (e as Error).message }, 'model upgrade failed'));

async function resolveLanguage(languageId?: string): Promise<ScriptLanguage> {
  const all = (await listAll<Record<string, any>>('languages')).map((l) => upgradeLanguage(l) ?? l);
  const chosen =
    (languageId && all.find((l) => l.id === languageId)) ||
    all.find((l) => l.isDefault && l.enabled !== false) ||
    all.find((l) => l.enabled !== false);
  return {
    name: chosen?.name ?? 'Hindi',
    code: chosen?.code ?? 'hi',
    needsPhonetics: chosen ? chosen.needsPhonetics !== false : true,
    spokenGuide: String(chosen?.spokenGuide ?? ''),
    glossary: Array.isArray(chosen?.glossary) ? chosen.glossary : [],
  };
}

/**
 * The Gemini key for every Google call that is not a video render — scripts, storyboard
 * drawings, photo checks, imports. A key saved on the Gemini connection in APIs & models
 * wins; without one, the GOOGLE_API_KEY set on the service is used.
 */
async function googleKey(): Promise<string | undefined> {
  const creds = await listAll<Record<string, any>>('credentials');
  const google = creds.find((c) => c.provider === 'google-gemini' && c.enabled !== false);
  return google && google.usesEnvKey === false ? await getCredentialKey(google.id) : config.googleApiKey;
}
const scriptKey = googleKey;

/** Finds the people in a caption's stretch of film, when there is a Google key to ask with. */
async function peopleFinder(): Promise<((frames: Buffer[]) => ReturnType<typeof findPeople>) | undefined> {
  const key = await googleKey().catch(() => undefined);
  return key ? (frames) => findPeople(frames, key) : undefined;
}

/**
 * Read the brief and propose the project: which use cases, what goes in their fields,
 * the vehicle, the presenter, the call to action. What may actually be written into the
 * project is decided by applyBriefPlan, which only fills what the designer left blank.
 */
app.post<{ Body: { prompt?: string; clientId?: string } }>('/api/projects/plan', async (req, reply) => {
  const prompt = (req.body?.prompt ?? '').trim();
  if (!prompt) return reply.code(400).send({ code: 'plan-no-brief', message: 'Write the brief first.' });
  const apiKey = await scriptKey();
  if (!apiKey) {
    return reply
      .code(503)
      .send({ code: 'plan-no-key', message: 'Reading the brief needs a Google Gemini key. Add one in APIs & models.' });
  }
  try {
    const client = req.body?.clientId
      ? await getOne<Record<string, any>>('clients', req.body.clientId).catch(() => null)
      : null;
    const [cars, actors] = await Promise.all([
      listAll<Record<string, any>>('cars'),
      listAll<Record<string, any>>('actors'),
    ]);
    // A dealer's own brands first: those are the vehicles this film can actually show.
    const brands: string[] = client?.brands?.length ? client.brands : client?.brand ? [client.brand] : [];
    const mine = brands.length ? cars.filter((c) => brands.some((b) => brandMatches(String(c.brand ?? ''), b))) : cars;
    return await planFromBrief(
      {
        prompt,
        client: client as PlanContext['client'],
        cars: (mine.length ? mine : cars) as PlanContext['cars'],
        actors: actors as PlanContext['actors'],
      },
      apiKey,
    );
  } catch (e) {
    const err = e as PlanError;
    return reply.code(err.status ?? 502).send({ code: err.code ?? 'plan-failed', message: err.message });
  }
});

app.post<{
  Body: {
    brief?: Brief;
    languageId?: string;
    projectId?: string;
    /** The storyboard as it stands — locked lines stay, and the rest is written around them. */
    sceneOverrides?: Record<string, SceneOverride>;
  };
}>(
  '/api/script',
  async (req, reply) => {
  const brief = req.body?.brief;
  if (!brief || !Array.isArray(brief.categories) || !brief.categories.length) {
    return reply.code(400).send({ code: 'bad-request', message: 'A brief with at least one use case is required.' });
  }

  const ctx = buildContext(brief);
  if (!ctx.mode.speaks) {
    return reply.code(422).send({
      code: 'no-speech',
      message: 'This narration mode has no speech, so there is no script to write.',
    });
  }
  const plan = planScenes(buildBeats(ctx), ctx.totalDuration, ctx.maxChunk, { speaks: true });
  const overrides = req.body?.sceneOverrides ?? {};
  const scenes: ScriptScene[] = plan.scenes
    .map((sc, index) => {
      // A line the designer locked is not up for rewriting. It still goes to the
      // writer, marked as fixed, so the scenes around it are written to flow with
      // it — a rewrite that cannot see the kept lines writes past them.
      const ov = sceneEditFor(overrides, plan, sc);
      const kept = ov?.locked?.includes('dialogue') ? (ov.phonetic ?? ov.dialogue ?? '').trim() : '';
      return {
        index,
        title: sc.beat.title,
        direction: sc.beat.dialogue ?? '',
        seconds: sc.duration,
        // Measured without the silences at a part's edges, so no line spills across a cut.
        words: wordBudget(speakingSeconds(plan, sc), 1, brief.speechWpm),
        card: sc.beat.card,
        fixed: kept || undefined,
      };
    })
    .filter((sc) => sc.direction || sc.fixed);
  if (!scenes.some((sc) => !sc.fixed)) return { lines: [], model: '' };

  // Whatever the designer filled into the category fields is quotable fact.
  const facts: Record<string, string> = {};
  for (const id of brief.categories) {
    const cat = CATEGORY_BY_ID[id];
    // Read through the current field shapes: offers typed into the old fixed boxes
    // arrive as "Offer 1", "Offer 2"; a key no current field owns is left out, so
    // the writer is never handed the same offer twice under two names.
    for (const [key, value] of Object.entries(categoryValues(id, brief.fieldValues[id] ?? {}))) {
      const label = fieldLabel(cat, key);
      if (label === key || !String(value ?? '').trim()) continue;
      facts[label] = String(value);
    }
  }

  // The script is written by Gemini regardless of which model renders the video
  // — it is text, and it costs a rounding error next to a segment.
  const apiKey = await scriptKey();
  if (!apiKey) {
    return reply
      .code(503)
      .send({ code: 'script-no-key', message: 'Writing the script needs a Google Gemini key. Add one in APIs & models.' });
  }

  // A copywriter needs the product, not just its name. Pull the real variant off
  // the car record — price, fuel, gearbox — so the script can be specific instead
  // of reaching for adjectives.
  const project = req.body?.projectId
    ? await getOne<Record<string, any>>('projects', req.body.projectId)
    : null;
  // The writer must not say aloud what a caption already shows — and the caption
  // to avoid is the one the designer edited, not the template's.
  for (const sc of scenes) {
    const scene = plan.scenes[sc.index]!;
    sc.card = sceneCard(scene.beat, sceneEditFor(project?.sceneEdits ?? {}, plan, scene))?.text;
  }
  let carSubject: Record<string, unknown> | undefined;
  if (project?.carId) {
    const car = await getOne<Record<string, any>>('cars', project.carId).catch(() => null);
    if (car) {
      const variant = (car.variants ?? []).find((v: any) => v.name === project.carVariant);
      carSubject = {
        name: [car.brand, car.model].filter(Boolean).join(' '),
        variant: variant?.name ?? project.carVariant,
        priceLabel: variant?.priceLabel ?? variant?.price,
        fuel: variant?.fuel,
        transmission: variant?.transmission,
        colour: colourName(project.carColour) || undefined,
        specs: car.specs ?? {},
        highlights: (car.highlights ?? []).slice(0, 8),
      };
    }
  }
  const story = storyGuidance(brief);
  const theme = storyTheme(brief);

  try {
    const out = await writeScript(
      {
        scenes,
        language: await resolveLanguage(req.body?.languageId),
        subject: {
          // The designer's own sentence outranks everything the templates assume.
          assignment: project?.prompt,
          // One ad, however many use cases: the writer is briefed on the combined story,
          // not on whichever use case was picked first.
          useCase: story.useCase,
          purpose: story.purpose,
          avoid: story.avoid,
          combined: brief.categories.length > 1,
          theme: theme ? themeDirection(theme) : undefined,
          car: carSubject as never,
          presenter: [brief.actor?.style, brief.actor?.age].filter(Boolean).join(', ') || undefined,
        },
        gender: brief.actor?.gender === 'male' ? 'male' : 'female',
        clientKind: brief.dealer.kind,
        dealerName: ctx.brief.dealer.fictionalize
          ? ctx.brief.dealer.fakeDealer || ctx.brief.dealer.dealerName
          : ctx.brief.dealer.dealerName,
        brandModel: ctx.brief.dealer.fictionalize
          ? ctx.brief.dealer.fakeBrandModel || ctx.brief.dealer.brandModel
          : ctx.brief.dealer.brandModel,
        city: brief.dealer.city,
        // Already "test ride" for a two-wheeler, and never blank.
        cta: ctx.cta,
        facts,
        direction: (brief.extraDirection ?? []).join(' '),
        vehicleKind: brief.vehicleKind,
        wpm: brief.speechWpm,
      },
      apiKey,
    );
    // Each line is filed under its scene's key, which survives scenes being deleted.
    return { ...out, lines: out.lines.map((l) => ({ ...l, key: plan.scenes[l.index]?.beat.key })) };
  } catch (e) {
    const err = e as ScriptError;
    return reply.code(err.status ?? 502).send({ code: err.code ?? 'script-failed', message: err.message });
  }
  },
);

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
  // Veo 3.1 runs on the same Gemini key as Omni.
  await addModel(gemini.id, VEO_31_DEFAULTS);
  await addModel(gemini.id, VEO_31_FAST_DEFAULTS);
  await addModel(gemini.id, VEO_31_LITE_DEFAULTS);
  await addModel(gemini.id, OMNI_FLASH_LEGACY_DEFAULTS);
  // The Omni record predates the version in its name; say which Omni it is.
  const staleOmni = models.find((m) => m.modelId === 'gemini-omni-1.1-flash' && m.name === 'Gemini Omni Flash');
  if (staleOmni) {
    await patch('models', staleOmni.id, { name: OMNI_FLASH_DEFAULTS.name, resolutions: OMNI_FLASH_DEFAULTS.resolutions });
    added.push(`renamed to ${OMNI_FLASH_DEFAULTS.name}`);
  }

  // Languages ship with the same additive guarantee: only what is missing.
  const languages = await listAll<Record<string, any>>('languages');
  for (const seed of LANGUAGE_SEEDS) {
    if (languages.some((l) => l.code === seed.code)) continue;
    await upsert('languages', seed);
    added.push(`${seed.name} language guide`);
  }

  const byteplus = await credFor('byteplus-ark', {
    name: 'BytePlus ModelArk',
    hasKey: false,
    enabled: true,
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    notes: 'Paste the ModelArk API key below — it is stored server-side only.',
  });
  await addModel(byteplus.id, SEEDANCE_25_DEFAULTS);
  await addModel(byteplus.id, SEEDANCE_20_FAST_DEFAULTS);

  return {
    added,
    models: await listAll('models'),
    credentials: await listAll('credentials'),
    languages: await listAll('languages'),
  };
});

/* ---- vehicle library sync: Brand → Model → Variant → Colour ---- */

/** The brands the team sells for, with how much of each is already in the library. */
app.get('/api/brands', async () => {
  const cars = await listAll<Record<string, any>>('cars');
  return {
    items: BRAND_CATALOGUE.map((b) => ({
      ...b,
      synced: cars.filter((c) => (c.kind ?? 'car') === b.kind && String(c.brand ?? '').toLowerCase().startsWith(b.slug.split('-')[0]!)).length,
    })),
  };
});

/**
 * Every current model a brand sells, without syncing anything. Cheap: one fetch.
 * Any brand the source knows works, not only the catalogue — the catalogue just
 * supplies extras like Maruti's second Nexa listing.
 */
app.get<{ Querystring: { brand?: string; kind?: VehicleKind } }>(
  '/api/brands/models',
  async (req, reply) => {
    const typed = (req.query?.brand ?? '').trim();
    if (!typed) return reply.code(400).send({ code: 'bad-request', message: 'brand is required' });
    const asked = BRAND_CATALOGUE.find((x) => x.slug === typed || brandMatches(x.name, typed));
    const kind: VehicleKind = req.query?.kind ?? asked?.kind ?? 'car';
    // Only borrow the catalogue's display name when the vehicle type agrees:
    // "Suzuki" under bikes was being labelled "Maruti Suzuki" via the car alias.
    const known = asked?.kind === kind ? asked : undefined;
    const found = await listBrandModels(typed, kind, known?.alsoPages ?? []);
    return { brand: { name: known?.name ?? typed, slug: found.slug, kind }, items: found.items };
  },
);

/**
 * Pull a whole brand into the library.
 *
 * One brand per request: nine brands is 176 models and roughly half an hour of
 * fetching, which is a request nobody should be holding open. `limit` exists so
 * a few models can be tried before committing to the whole line-up.
 */
app.post<{ Body: { brand?: string; kind?: VehicleKind; limit?: number; refresh?: boolean } }>(
  '/api/brands/sync',
  async (req, reply) => {
    const typed = (req.body?.brand ?? '').trim();
    if (!typed) return reply.code(400).send({ code: 'bad-request', message: 'brand is required' });
    const asked = BRAND_CATALOGUE.find((x) => x.slug === typed || brandMatches(x.name, typed));
    const kind: VehicleKind = req.body?.kind ?? asked?.kind ?? 'car';
    // Only borrow the catalogue's display name when the vehicle type agrees:
    // "Suzuki" under bikes was being labelled "Maruti Suzuki" via the car alias.
    const known = asked?.kind === kind ? asked : undefined;
    const found = await listBrandModels(typed, kind, known?.alsoPages ?? []);
    if (!found.items.length) {
      return reply.code(404).send({
        code: 'brand-not-found',
        message: `No current models found for "${typed}" on ${kind === 'bike' ? 'BikeDekho' : 'CarDekho'}. Check the spelling, or try the name as the site writes it.`,
      });
    }
    const b = { name: known?.name ?? title(typed), slug: found.slug, kind };
    const models = found.items;
    const wanted = req.body?.limit ? models.slice(0, Math.max(1, req.body.limit)) : models;
    const existing = await listAll<Record<string, any>>('cars');

    const results: { slug: string; name: string; status: string; note?: string }[] = [];
    for (const m of wanted) {
      // Must match the id syncVehicleModel writes, or the skip never fires and
      // an existing library is re-fetched from scratch every time.
      const id = (b.kind === 'car' ? '' : `${b.kind}__`) + `${b.slug}__${m.slug}`;
      if (!req.body?.refresh && existing.some((c) => c.id === id)) {
        results.push({ slug: m.slug, name: m.name, status: 'already in library' });
        continue;
      }
      try {
        const profile = await syncVehicleModel(`${b.slug}/${m.slug}`, { kind: b.kind, apiKey: await googleKey() });
        const prior = existing.find((c) => c.id === profile.id);
        await upsert('cars', { ...profile, source: 'cardekho', createdAt: prior?.createdAt ?? profile.createdAt });
        results.push({
          slug: m.slug,
          name: m.name,
          status: profile.syncStatus,
          note: `${Object.keys(profile.images).length} angles, ${profile.colours.length} colours, ${
            profile.variants.length
          } variants, ${Object.keys(profile.specs ?? {}).length} specs`,
        });
      } catch (e) {
        results.push({ slug: m.slug, name: m.name, status: 'failed', note: (e as Error).message });
      }
    }
    return { brand: b, found: models.length, synced: results.length, results };
  },
);

app.post<{
  Body: {
    query?: string;
    kind?: 'car' | 'bike';
    refresh?: boolean;
    /** Which site to read this vehicle from. Defaults to CarDekho, as it always did. */
    source?: VehicleDataSource;
    /** The manufacturer's page, when the source is the OEM. */
    url?: string;
    /** Re-syncing a vehicle already in the library: its record is kept, so projects follow the switch. */
    id?: string;
  };
}>('/api/cars/sync', async (req, reply) => {
  const asked = req.body?.source;
  const source: VehicleDataSource = asked === 'oem' || asked === 'google' ? asked : 'cardekho';
  const held = req.body?.id ? await getOne<Record<string, any>>('cars', req.body.id) : null;

  // Google: ask which pages carry this model's photographs, then read them the
  // way a manufacturer's page is read.
  if (source === 'google') {
    const query = req.body?.query?.trim() || [held?.brand, held?.model].filter(Boolean).join(' ');
    if (!query) {
      return reply.code(400).send({ code: 'bad-request', message: 'Name the model to look for.' });
    }
    try {
      const profile = await syncGoogleModel({
        query,
        kind: req.body?.kind ?? held?.kind ?? 'car',
        id: held?.id,
        brand: held?.brand,
        model: held?.model,
        apiKey: (await scriptKey()) ?? '',
      });
      const prior = held ?? (await getOne<{ createdAt?: number }>('cars', profile.id));
      return await upsert('cars', {
        ...profile,
        oemUrl: held?.oemUrl,
        createdAt: prior?.createdAt ?? profile.createdAt,
      });
    } catch (e) {
      const err = e as OemSyncError;
      return reply.code(err.status ?? 502).send({ code: err.code ?? 'google-sync-failed', message: err.message });
    }
  }

  if (source === 'oem') {
    const url = (req.body?.url ?? held?.oemUrl ?? '').trim();
    if (!url) {
      return reply.code(400).send({ code: 'bad-request', message: 'A manufacturer page URL is required.' });
    }
    try {
      const profile = await syncOemModel({
        url,
        kind: req.body?.kind ?? held?.kind ?? 'car',
        // A vehicle already in the library keeps its record, its id and its name.
        id: held?.id,
        brand: held?.brand,
        model: held?.model,
        apiKey: (await scriptKey()) ?? '',
      });
      const prior = held ?? (await getOne<{ createdAt?: number }>('cars', profile.id));
      return await upsert('cars', { ...profile, createdAt: prior?.createdAt ?? profile.createdAt });
    } catch (e) {
      const err = e as OemSyncError;
      return reply.code(err.status ?? 502).send({ code: err.code ?? 'oem-sync-failed', message: err.message });
    }
  }

  const query = req.body?.query?.trim() || [held?.brand, held?.model].filter(Boolean).join(' ');
  if (!query) return reply.code(400).send({ code: 'bad-request', message: 'query required (e.g. "Hyundai Creta")' });
  try {
    // With a key, every photo is looked at and filed under what it shows.
    const profile = await syncVehicleModel(query, {
      kind: req.body?.kind ?? held?.kind ?? 'car',
      apiKey: await googleKey(),
    });
    // Switching an existing vehicle back to CarDekho writes into the same record; the
    // manufacturer's page is kept so the switch can be made again without retyping it.
    const id = held?.id ?? profile.id;
    const existing = held ?? (await getOne<{ createdAt?: number }>('cars', profile.id));
    return await upsert('cars', {
      ...profile,
      id,
      source: 'cardekho',
      oemUrl: held?.oemUrl,
      createdAt: existing?.createdAt ?? profile.createdAt,
    });
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

/* ---- client import from its own website ---- */
app.post<{ Body: { url?: string } }>('/api/clients/website', async (req, reply) => {
  const url = (req.body?.url ?? '').trim();
  if (!url) return reply.code(400).send({ code: 'site-no-url', message: 'Paste the website address first.' });
  try {
    return await importWebsite(url, await scriptKey().catch(() => undefined));
  } catch (e) {
    const err = e as { code?: string; message?: string; status?: number };
    return reply
      .code(err.status ?? 502)
      .send({ code: err.code ?? 'site-import-failed', message: err.message ?? 'Could not read that website.' });
  }
});

/**
 * The resolution a brief asks for. Unset means 720p, which is what every
 * project before 1080p was made at. The model may render lower — Seedance tops
 * out at 720p — in which case post-production upscales (see renderSegment).
 */
const wantedResolution = (brief: Brief): Resolution =>
  brief.resolution === '1080p' || brief.resolution === '480p' || brief.resolution === '360p'
    ? brief.resolution
    : '720p';

interface GenerateBody {
  brief: Brief;
  parts: PromptPart[];
  confirmedCostInr?: number;
  /** VideoModelProfile id. Falls back to the default model, then the deploy key. */
  modelId?: string;
  /** Files this generation under a project so it shows in that project's history. */
  projectId?: string;
  projectName?: string;
  /** Storyboard edits — the captions are composited from these. */
  sceneOverrides?: Record<string, SceneOverride>;
  /** Chosen by the browser so it can stop the run while this request is still open. */
  jobId?: string;
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
  usdPerSecondByResolution?: Partial<Record<Resolution, number>>;
  resolutions?: Resolution[];
  /** Requests a day the provider allows, when it is known. */
  dailyRequestLimit?: number;
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
    const fallbackKey = await googleKey();
    if (!fallbackKey)
      return { code: 'omni-flash-not-configured', error: 'No model configured and GOOGLE_API_KEY is not set.' };
    return {
      provider: 'google-gemini',
      modelId: config.omniFlashModel,
      apiKey: fallbackKey,
      maxReferenceImages: 3,
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
    maxReferenceImages: Number(chosen.maxReferenceImages ?? 3),
    usdPerSecond: Number(chosen.usdPerSecond ?? config.usdPerSecond),
    supportsImageToVideo: chosen.supportsImageToVideo !== false,
    minClipSec: Number(chosen.minClipSec ?? 3),
    maxClipSec: Number(chosen.maxClipSec ?? 10),
    label: chosen.name ?? chosen.modelId,
    usdPerSecondByResolution: chosen.usdPerSecondByResolution,
    resolutions: Array.isArray(chosen.resolutions) ? chosen.resolutions : undefined,
    dailyRequestLimit: Number(chosen.dailyRequestLimit) || undefined,
  };
}

/**
 * Refuse a run on a model whose day is already spent, before a request is made.
 *
 * Counted by the app, or told by Google on the last refusal. Either way, starting
 * the run would spend requests that fail and count against a day already over.
 */
async function dailyBlock(model: ResolvedModel): Promise<{ code: string; message: string; resetsAt: number } | null> {
  const u = (await usageToday([model.modelId]).catch(() => ({}) as Record<string, never>))[model.modelId];
  if (!u) return null;
  const limit = model.dailyRequestLimit;
  const out = (u.exhaustedUntil ?? 0) > Date.now() || Boolean(limit && u.requests >= limit);
  if (!out) return null;
  return {
    code: 'daily-limit',
    resetsAt: u.resetsAt,
    message: `${model.label}'s daily limit${limit ? ` of ${limit} requests` : ''} is used up. It comes back at ${resetTimeLabel(u.resetsAt)}. Pick another model in Video to generate now.`,
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
    /** The deliverable resolution. The model may render lower; post upscales. */
    resolution: Resolution;
    seedFrame?: Buffer;
    /** A frame of the vehicle from the opening part — what it must keep looking like. */
    anchorFrame?: Buffer;
    /** Stills of this part's scenes, drawn beforehand. The composition to match. */
    frames?: LabelledRef[];
    /** Photos of the vehicle for this part, best first. These outrank everything. */
    carRefs?: LabelledRef[];
    /** The presenter. Given a slot on every part, whatever else is competing for one. */
    actorRef?: LabelledRef;
    /** The dealership. Given a slot on every part. */
    placeRef?: LabelledRef;
    /** Everything else in scope — project extras, further showroom photos. */
    references: LabelledRef[];
    /** Reference videos. Only Omni is sent these; the others ignore them. */
    videoRefs?: LabelledRef[];
  },
): Promise<{ bytes: Buffer; interactionId: string; renderResolution: Resolution }> {
  const seeded = Boolean(req.seedFrame) && model.supportsImageToVideo;
  const { render } = renderResolution(model.modelId, req.resolution, model.resolutions);

  if (model.provider === 'byteplus-ark') {
    const refs: SeedanceRef[] = [];
    if (seeded) refs.push({ data: req.seedFrame!.toString('base64'), mimeType: 'image/jpeg', role: 'first_frame' });
    const all = [...(req.carRefs ?? []), ...req.references];
    for (const r of all.slice(0, Math.max(0, model.maxReferenceImages - refs.length))) {
      if (r.ref.data) refs.push({ data: r.ref.data, mimeType: r.ref.mimeType, role: 'reference_image' });
    }
    const clip = await generateSeedanceClip(
      {
        prompt: req.prompt,
        model: model.modelId,
        aspect: req.aspect,
        // Seedance renders 480p/720p/1080p; a 360p ask lands on its smallest.
        resolution: render === '360p' ? '480p' : render,
        duration: req.duration,
        minSec: model.minClipSec,
        maxSec: model.maxClipSec,
        references: refs.length ? refs : undefined,
        generateAudio: true,
        onAttempt: () => countRequest(model.modelId),
      },
      model.apiKey,
    );
    return { bytes: clip.bytes, interactionId: clip.taskId, renderResolution: render };
  }

  // Veo 3.1 shares the Gemini key with Omni but is a different API: a
  // long-running operation that renders only 4, 6 or 8 seconds. It comes back
  // at least as long as planned, so it is trimmed to the segment before the
  // crossfades, captions and seed frames downstream ever see it.
  if (/^veo-/.test(model.modelId)) {
    const veoRes = render === '1080p' ? '1080p' : '720p';
    const clip = await generateVeoClip(
      {
        prompt: req.prompt,
        model: model.modelId,
        aspect: req.aspect,
        resolution: veoRes,
        duration: req.duration,
        firstFrame: seeded ? { data: req.seedFrame!.toString('base64'), mimeType: 'image/jpeg' } : undefined,
        references: [...(req.carRefs ?? []), ...req.references]
          .filter((r) => r.ref.kind === 'image' && r.ref.data)
          .slice(0, Math.min(3, model.maxReferenceImages))
          .map((r) => ({ data: r.ref.data!, mimeType: r.ref.mimeType })),
        onAttempt: () => countRequest(model.modelId),
        dailyLimit: model.dailyRequestLimit,
      },
      model.apiKey,
    );
    return {
      bytes: await trimClip(clip.bytes, req.duration),
      interactionId: clip.operation,
      renderResolution: veoRes,
    };
  }

  // Google Gemini (Omni Flash): the seed frame is frame 1, so the model
  // continues the motion rather than restarting it.
  const shown: LabelledRef[] = [];
  if (seeded) {
    shown.push({
      ref: { data: req.seedFrame!.toString('base64'), mimeType: 'image/jpeg', kind: 'image' },
      label:
        'where the part before this one ended — carry the same presenter, the same vehicle, the same place and the same light straight on from here',
      filename: 'seed-frame.jpg',
    });
  }
  /*
   * What every part is shown, in order, and why the order is fixed.
   *
   * Until now a continuation was made with `image_to_video`: the previous part's
   * last frame became frame one and the reference photographs rode along. Across
   * six runs the pattern never varied — the opening part, made with
   * `reference_to_video`, came back with the right car; every part after it came
   * back with an older XUV, however many photographs were attached. A seeded part
   * was not being held by its references.
   *
   * So every part is now made the way the opening part is, and the frame it
   * continues from travels as one more reference rather than as frame one. The cut
   * between parts is a shade less tight; the car and the presenter survive it,
   * which is the trade worth making.
   *
   * Three things are guaranteed a slot on every part, because a film missing any
   * of them is unusable: the vehicle, the presenter, the dealership.
   */
  const anchor: LabelledRef | undefined = req.anchorFrame
    ? {
        ref: { data: req.anchorFrame.toString('base64'), mimeType: 'image/jpeg', kind: 'image' },
        label: 'a frame of the vehicle from the opening part — it must keep looking like this',
        filename: 'anchor-frame.jpg',
      }
    : undefined;
  // orderReferences is the one rule, and the editor calls it too — so the list a
  // designer checks before paying is the list that is actually sent.
  shown.push(
    ...orderReferences<LabelledRef>({
      seed: shown[0],
      frames: req.frames ?? [],
      car: req.carRefs ?? [],
      actor: req.actorRef,
      place: req.placeRef,
      anchor,
      rest: req.references,
      videos: req.videoRefs ?? [],
      max: model.maxReferenceImages,
    }).filter((r) => r !== shown[0]),
  );
  const refs = shown.map((r) => r.ref);

  /*
   * Which image is which.
   *
   * Google's own examples address references as <IMAGE_REF_0>, <IMAGE_REF_1> …
   * so the model is told what each slot holds rather than left to work out which
   * photograph is the car, which is the showroom and which is the frame it is
   * continuing. Ten unexplained images are ten guesses.
   */
  const legend = shown.length
    ? [
        '## REFERENCE IMAGES',
        ...shown.map((r, i) => `<IMAGE_REF_${i}> — ${r.label}`),
        // A reference is a record of what something looks like, and a video model
        // will draw one if it is not told otherwise: a run on 13 September put a
        // contact sheet on screen, tiles, gutters and captions.
        '',
        'These images are records of what the subjects look like. They are never things to put on screen. Do not film, show, reflect or hang any photograph, grid of photographs, contact sheet, caption, watermark or screen showing them. Film the real vehicle and the real people in the real location.',
        '',
      ].join('\n')
    : '';
  const promptWithLegend = legend ? `${legend}\n${req.prompt}` : req.prompt;

  // Omni renders 360p, 720p, 1080p and 4K — never 480p, which renderResolution
  // has already mapped away; this is the last guard.
  const omniRes = render === '480p' ? '720p' : render;
  /**
   * How many references the provider actually accepts is a property of the model,
   * not of this code, and the profile's number is only our best guess. Asking for
   * one too many comes back as an argument error — so it drops one and asks again
   * rather than failing the run or quietly sending too few.
   */
  const send = async (list: OmniRef[]): Promise<Awaited<ReturnType<typeof generateClip>>> => {
    try {
      return await generateClip(
        {
          prompt: promptWithLegend,
          aspect: req.aspect,
          resolution: omniRes,
          references: list.length ? list : undefined,
          // Every part is a reference task now, the continuations included: a
          // seeded part was not being held by its references, and came back with
          // a different car every single time.
          task: list.length ? 'reference_to_video' : 'text_to_video',
          model: model.modelId,
          onAttempt: () => countRequest(model.modelId),
          dailyLimit: model.dailyRequestLimit,
        },
        model.apiKey,
      );
    } catch (err) {
      const message = (err as Error).message ?? '';
      const tooMany = /reference|image|invalid.?argument|too many|at most/i.test(message);
      // A day's cap is never a reference problem — dropping a photo would only spend another request.
      if (tooMany && list.length > 1 && (err as OmniFlashError).code !== 'daily-limit') {
        app.log.warn({ sent: list.length, message }, 'provider refused the reference set; retrying with one fewer');
        return send(list.slice(0, list.length - 1));
      }
      throw err;
    }
  };
  const clip = await send(refs);
  let bytes: Buffer | null = clip.base64 ? Buffer.from(clip.base64, 'base64') : null;
  if (!bytes && clip.fileId) {
    try {
      bytes = (await downloadFile(clip.fileId, model.apiKey)).bytes;
    } catch (err) {
      // The video was generated; only Google's file copy of it failed. Read it
      // back from the finished interaction instead of paying to make it again.
      bytes = await fetchInteractionVideo(clip.interactionId, model.apiKey).catch(() => null);
      if (!bytes) {
        app.log.error(
          { interactionId: clip.interactionId, fileId: clip.fileId, message: (err as Error).message },
          'omni file failed and the interaction had no inline video',
        );
        throw err;
      }
      app.log.warn({ interactionId: clip.interactionId, fileId: clip.fileId }, 'omni file failed; recovered the video from the interaction');
    }
  }
  if (!bytes) throw new OmniFlashError('omni-flash-no-video', 'Clip had neither base64 nor a file id.');
  return { bytes, interactionId: clip.interactionId, renderResolution: omniRes };
}

/**
 * Read the brief's attachments back out of Cloud Storage and sort them: image
 * references get grounded into the model, logos are overlay assets that post
 * composites (the model garbles any logo it tries to draw).
 */
/** A reference image and what it is a picture of — the legend the prompt cites. */
interface LabelledRef {
  ref: OmniRef;
  /** Named in the prompt beside its slot: "the vehicle, front three-quarter". */
  label: string;
  /** The stored filename, for the run's receipt. */
  filename: string;
  /** A contact sheet — several photographs in one image, which must never be drawn as one. */
  sheet?: boolean;
  /** For a dealership photograph, the part of the place it shows. */
  view?: DealerView;
}

/** A photo of the vehicle, with the side of it that the photo shows. */
interface CarRef extends LabelledRef {
  angle?: DealerPhoto['angle'];
}

async function loadBriefAssets(brief: Brief): Promise<{
  /** Everything that is not the vehicle: the showroom, the team, project extras. */
  references: LabelledRef[];
  /**
   * Every photo of the vehicle in scope — attached to the project or from the
   * library — each carrying the side it shows. Continuation parts are sent one of
   * these rather than only a frame of the film, because a frame can only be as
   * right as the part it came from.
   */
  carRefs: CarRef[];
  /** The presenter's own photograph. Reserved a slot on every part. */
  actorRef?: LabelledRef;
  /** One photograph of the dealership. Reserved a slot on every part. */
  placeRef?: LabelledRef;
  /** Reference videos, for the models that take them. Omni accepts three. */
  videoRefs: LabelledRef[];
  dealerLogo?: Buffer;
  brandLogo?: Buffer;
}> {
  const references: LabelledRef[] = [];
  const carRefs: CarRef[] = [];
  const videoRefs: LabelledRef[] = [];
  let actorRef: LabelledRef | undefined;
  let dealerLogo: Buffer | undefined;
  let brandLogo: Buffer | undefined;
  const noun = brief.vehicleKind === 'bike' ? 'the bike' : 'the car';

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
    if (a.kind === 'reference-video') {
      videoRefs.push({
        ref: {
          data: obj.bytes.toString('base64'),
          mimeType: obj.contentType || 'video/mp4',
          kind: 'video',
        },
        filename: a.filename,
        label: `a reference video — ${a.label}`,
      });
      continue;
    }
    const ref: OmniRef = {
      data: obj.bytes.toString('base64'),
      mimeType: obj.contentType || 'image/jpeg',
      kind: 'image',
    };
    if (a.kind === 'car-model') {
      // A sheet carries its own warning in the label the brief wrote for it; a
      // single photograph just needs naming by the side it shows.
      const side = a.sheet ? a.label : a.angle ? `${noun}, ${a.angle}` : `${noun} — ${a.label}`;
      carRefs.push({ ref, filename: a.filename, label: side, angle: a.angle, sheet: a.sheet });
    } else if (a.kind === 'actor') {
      // First of the rest: the same face, hair and clothes in every part.
      actorRef = {
        ref,
        filename: a.filename,
        label: `${a.label} — the same face, hair and clothes in every shot`,
      };
    } else {
      references.push({
        ref,
        filename: a.filename,
        label: a.sheet ? a.label : `${a.kind === 'extra' ? 'a reference for this film' : 'the dealership'} — ${a.label}`,
        sheet: a.sheet,
        view: a.view,
      });
    }
  }

  return {
    references: actorRef ? [actorRef, ...references] : references,
    carRefs,
    actorRef,
    placeRef: references[0],
    // Three is Omni's limit, and the first three are the ones the designer chose first.
    videoRefs: videoRefs.slice(0, 3),
    dealerLogo,
    brandLogo,
  };
}

/**
 * Which part of the dealership a shot is set in, read from the shot itself.
 *
 * A showroom is several rooms, and every scene used to be handed whichever
 * dealership photograph happened to be first. So a wide exterior of the building
 * was drawn from a photograph of the showroom floor, and the film opened on
 * somebody else's forecourt.
 */
const PLACE_WORDS: [DealerView, RegExp][] = [
  ['exterior', /exterior|facade|fa\u00e7ade|forecourt|outside|street|entrance|signage|building|kerb|curb|frontage|drive-?way|car park/i],
  ['delivery', /delivery|handover|hand-?over|keys?\b|garland|ribbon|ceremony|collect/i],
  ['lounge', /lounge|waiting|reception|seating|sofa|desk|cafe|coffee|sit(-| )down|consultation/i],
  ['team', /team|staff|salesperson|service bay|technician|workshop|advisor/i],
  ['interior', /showroom floor|inside the showroom|indoor|shop floor|display area|under showroom/i],
];

export function placeViewFor(shot: string): DealerView | undefined {
  const text = shot ?? '';
  for (const [view, rx] of PLACE_WORDS) if (rx.test(text)) return view;
  return undefined;
}

/** The dealership photograph a shot should be built on, best first. */
function placeRefsFor(shot: string, references: LabelledRef[]): LabelledRef[] {
  const want = placeViewFor(shot);
  const places = references.filter((r) => r.view || /dealership/.test(r.label));
  const matched = want ? places.filter((r) => r.view === want) : [];
  // The matching room first, then any other photograph of the place.
  return [...matched, ...places.filter((r) => !matched.includes(r)), ...references.filter((r) => !places.includes(r))];
}

/** Angles in the order they are worth showing when a part asks for nothing specific. */
const ANGLE_PRIORITY: DealerPhoto['angle'][] = ['front', 'side', 'rear', 'interior'];

/**
 * The vehicle photos this part of the film should be built on, best first.
 *
 * A part that frames the cabin is sent the cabin photo; a part that frames the
 * back is sent the back. What a part is never sent is nothing at all — which is
 * what used to happen to every part after the first, and is why a film could open
 * on the right car and finish on a different one.
 */
function carRefsForPart(
  part: { start: number; end: number },
  scenePlan: ScenePlan | null,
  brief: Brief,
  sceneOverrides: Record<string, SceneOverride> | undefined,
  carRefs: CarRef[],
): CarRef[] {
  if (!carRefs.length) return [];
  const wanted: string[] = [];
  for (const sc of scenePlan?.scenes ?? []) {
    if (sc.end <= part.start || sc.start >= part.end) continue;
    const edit = sceneOverrides?.[sc.beat.key ?? ''] ?? {};
    const visual = sceneVisual(edit.shot ?? sc.beat.shot, edit.ref, brief.attachments ?? [], brief.vehicleKind ?? 'car');
    if (visual.kind === 'picked' || visual.kind === 'matched') wanted.push(visual.photo.filename);
  }
  const picked: CarRef[] = [];
  const take = (r: CarRef | undefined) => {
    if (r && !picked.includes(r)) picked.push(r);
  };
  for (const filename of wanted) take(carRefs.find((r) => r.filename === filename));
  for (const angle of ANGLE_PRIORITY) take(carRefs.find((r) => r.angle === angle));
  for (const r of carRefs) take(r);
  return picked;
}

/**
 * The storyboard frames for this part of the film.
 *
 * Drawn beforehand from the same photographs, so each one already settles the
 * camera, the framing and where everyone stands. They go in front of the
 * photographs, which only say what the subjects look like.
 */
async function framesForPart(
  part: { start: number; end: number },
  scenePlan: ScenePlan | null,
  sceneOverrides: Record<string, SceneOverride> | undefined,
): Promise<LabelledRef[]> {
  if (!sceneOverrides) return [];
  const out: LabelledRef[] = [];
  for (const sc of scenePlan?.scenes ?? []) {
    if (sc.end <= part.start || sc.start >= part.end) continue;
    const frame = sceneOverrides[sc.beat.key ?? '']?.frame;
    if (!frame?.storagePath || out.some((r) => r.filename === frame.filename)) continue;
    const obj = await readObject(frame.storagePath).catch(() => null);
    if (!obj) continue;
    out.push({
      ref: { data: obj.bytes.toString('base64'), mimeType: obj.contentType || 'image/png', kind: 'image' },
      filename: frame.filename,
      label: `how the shot "${sc.beat.title}" is framed — the camera, the distance and where everything sits. Match this composition.`,
    });
  }
  return out;
}

/**
 * The deterministic brand furniture laid over the finished cut.
 *
 * Captions are laid out from the same brief and storyboard edits the prompt was
 * built from, so the text the designer typed lands on exactly the scene they
 * typed it on, and what the video shows cannot drift from what it says.
 */
function buildOverlay(
  brief: Brief,
  sceneOverrides: Record<string, SceneOverride> | undefined,
  dealerLogo?: Buffer,
  brandLogo?: Buffer,
  musicBed?: Buffer,
): BrandOverlay {
  const copy = overlayCopy(brief);
  const plan = buildPrompt(brief, { sceneOverrides })?.scenePlan;
  // Each logo in the corner the client asked for — and a logo switched off, nowhere.
  const logos = logoLayout(brief.logoPlacement);
  return {
    footerText: copy.footerText,
    dealerLogo: logos.dealer === 'off' ? undefined : dealerLogo,
    brandLogo: logos.brand === 'off' ? undefined : brandLogo,
    logoPlacement: logos,
    // Films made before looks existed were all Midnight, and a retake of one stays Midnight.
    theme: brief.overlayTheme ?? overlayTheme(),
    cards: plan ? overlayCards(plan, sceneOverrides ?? {}) : [],
    endCard:
      brief.endCardOn && copy.endCardLines.length ? { lines: copy.endCardLines, seconds: 3 } : undefined,
    // A 1080p deliverable from a model that rendered 720p is upscaled here.
    targetShortSide: shortSideFor(wantedResolution(brief)),
    musicBed,
    // Up in the pauses and over the end card, down about 12 dB under every spoken
    // line. A film with no speech has nothing to dip under.
    musicLoudness: -20,
    musicDuckDb: buildContext(brief).mode.speaks ? -12 : 0,
    // The storyboard's pace plays the finished film faster; the model always speaks at a natural read.
    speed: clampPace(brief.pace),
  };
}

/**
 * The film's music: one Lyria track under the whole cut, made while the first
 * segment renders so it adds no waiting. It never fails a run — without a bed the
 * film simply goes out with no music — and it is saved with the job so a retake
 * or restitch lays the same track back under the new cut.
 */
async function makeMusicBed(
  brief: Brief,
  jobId: string,
  filmSeconds: number,
): Promise<{ bytes: Buffer; storagePath?: string } | null> {
  const apiKey = await scriptKey().catch(() => undefined);
  if (!apiKey) return null;
  const ctx = buildContext(brief);
  try {
    const bed = await generateMusicBed(
      {
        description: ctx.music || storyTheme(brief)?.music || CATEGORY_BY_ID[brief.categories[0]!]?.music || '',
        // Longer than the film and trimmed to it, so the track never has to repeat.
        seconds: filmSeconds + 10,
        speaks: ctx.mode.speaks,
      },
      apiKey,
    );
    const ext = bed.mimeType.includes('wav') ? 'wav' : 'mp3';
    const put = await putRef(`music-${jobId}.${ext}`, bed.mimeType, bed.bytes).catch(() => null);
    return { bytes: bed.bytes, storagePath: put?.storagePath };
  } catch (e) {
    app.log.warn({ jobId, err: (e as Error).message }, 'music bed failed — the film goes out without one');
    return null;
  }
}

/**
 * How long a generation should take, learned from this app's own finished runs.
 *
 * No provider reports progress: Omni answers synchronously, Seedance and Veo only
 * say queued or running. So the honest figure is what the same model has
 * actually taken here — wall-clock seconds per second of video, the median of its
 * recent runs — scaled to this video. A model with no history yet gets a
 * cautious default, and the estimate sharpens as runs accumulate.
 */
const DEFAULT_SECONDS_PER_VIDEO_SECOND = 12;

app.get<{ Querystring: { modelId?: string; resolution?: string; seconds?: string; parts?: string } }>(
  '/api/generate/eta',
  async (req) => {
    const videoSeconds = Math.max(1, Number(req.query.seconds) || 1);
    const parts = Math.max(1, Math.round(Number(req.query.parts) || 1));
    const resolution = req.query.resolution || '720p';
    const picked = await resolveModel(req.query.modelId);
    const modelId = 'error' in picked ? '' : picked.modelId;
    // Runs saved before jobs carried a model id are matched by name — including
    // Omni's name from before it said which version it was.
    const names = new Set(
      'error' in picked
        ? []
        : [picked.label, ...(picked.modelId === 'gemini-omni-1.1-flash' ? ['Gemini Omni Flash'] : [])],
    );
    const sameModel = (j: JobRecord): boolean =>
      j.modelId ? j.modelId === modelId : Boolean(j.modelName && names.has(j.modelName));

    // Fresh generations only: a retake re-uses most of its segments and finishes
    // in a fraction of the time, which would drag the estimate down.
    const finished = (await listRecentJobs(300)).filter(
      (j) => j.status === 'done' && !j.parentJobId && sameModel(j),
    );
    const sameRes = finished.filter((j) => (j.resolution || '720p') === resolution);
    const rate = (j: JobRecord): number => {
      const ms = (j.finishedAt ?? j.updatedAt) - (j.startedAt ?? j.createdAt);
      return j.totalSeconds > 0 && ms > 0 ? ms / 1000 / j.totalSeconds : 0;
    };
    const pool = (sameRes.length >= 2 ? sameRes : finished)
      .slice(0, 20)
      .map(rate)
      .filter((r) => r > 0);

    if (!pool.length) {
      return {
        seconds: Math.round(videoSeconds * DEFAULT_SECONDS_PER_VIDEO_SECOND + parts * 10 + 20),
        basis: 'default' as const,
        samples: 0,
      };
    }
    const sorted = [...pool].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    return { seconds: Math.round(videoSeconds * median), basis: 'history' as const, samples: pool.length };
  },
);

/**
 * P0.1 / P0.7 — generate the video by running the parts as a create-then-extend
 * chain on Omni Flash. Long-running (minutes): the Cloud Run request timeout is
 * raised in deploy config; progress is written to the Firestore job record so a
 * reload can recover via GET /api/generate/:jobId.
 */
/**
 * How much of today each model has left, for the picker and the Generate panel.
 *
 * Counted by the app — it cannot see requests made outside it on the same key —
 * and overruled by Google the moment a refusal names the day's cap.
 */
app.get('/api/models/usage', async () => {
  const models = await listAll<Record<string, any>>('models');
  const usage = await usageToday(models.map((m) => String(m.modelId ?? ''))).catch(
    () => ({}) as Record<string, never>,
  );
  const now = Date.now();
  return {
    resetsAt: nextPacificMidnight(now),
    items: models.map((m) => {
      const u = usage[String(m.modelId)];
      const limit = Number(m.dailyRequestLimit) || null;
      const requests = u?.requests ?? 0;
      return {
        id: String(m.id),
        modelId: String(m.modelId),
        requests,
        limit,
        exhausted: (u?.exhaustedUntil ?? 0) > now || Boolean(limit && requests >= limit),
      };
    }),
  };
});

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

  const spent = await dailyBlock(resolved);
  if (spent) return reply.code(429).send(spent);

  const wanted = wantedResolution(brief);
  const plannedRes = renderResolution(resolved.modelId, wanted, resolved.resolutions);
  // Priced at what the model renders: an upscaled 1080p costs what 720p costs.
  const usdPerSecond = priceFor(
    {
      modelId: resolved.modelId,
      usdPerSecond: resolved.usdPerSecond,
      usdPerSecondByResolution: resolved.usdPerSecondByResolution,
      resolutions: resolved.resolutions ?? ['720p'],
    },
    wanted,
  );
  const cost = estimateCost(brief, { usdPerSecond });
  if (cost.needsConfirmation && (confirmedCostInr ?? 0) < cost.inr) {
    return reply.code(428).send({
      code: 'cost-confirmation-required',
      message: 'This run is over the ₹500 approval threshold — approve the spend and send it again.',
      ...(allows(req.caller ?? null, 'admin') ? { cost } : {}),
    });
  }

  // The browser names the run so it can stop it: this request does not answer until
  // the video is finished, and until then there is nothing else to address it by.
  const asked = String(req.body?.jobId ?? '');
  const jobId = /^[0-9a-f-]{10,64}$/i.test(asked) ? asked : randomUUID();
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
    userId: req.caller?.uid,
    userEmail: req.caller?.email,
    userName: req.caller?.name,
    projectId: req.body?.projectId,
    projectName: req.body?.projectName,
    label: `${cost.totalSeconds}s · ${brief.categories.length} use case${brief.categories.length === 1 ? '' : 's'}`,
    modelName: resolved.label,
    modelId: resolved.modelId,
    status: 'running',
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    categories: brief.categories,
    dealerName: brief.dealer.dealerName,
    aspect: brief.aspect,
    resolution: wanted,
    renderResolution: plannedRes.upscale ? plannedRes.render : undefined,
    totalSeconds: cost.totalSeconds,
    costInr: cost.inr,
    costUsd: cost.usd,
    usdPerSecond,
    clips,
    // The receipt for this run: what it was made from, so a later one can be
    // compared with it and a good one re-opened.
    brief: { ...brief, attachments: (brief.attachments ?? []).map(({ src, ...rest }) => rest) },
    projectSnapshot: req.body?.projectId
      ? await getOne<Record<string, unknown>>('projects', req.body.projectId).catch(() => null)
      : null,
    sceneEdits: req.body?.sceneOverrides,
    prompts: parts.map((p) => ({ part: p.partNum, text: p.partNum === 1 ? p.text : p.continuationText || p.text })),
    vehicle: {
      model: brief.carModel,
      colour: brief.carColour,
      photos: (brief.attachments ?? []).filter((a) => a.kind === 'car-model').length,
      attached: Boolean(brief.attachedCarPhotos),
      angles: [...new Set((brief.attachments ?? []).filter((a) => a.kind === 'car-model').map((a) => a.angle).filter(Boolean))] as string[],
    },
  };
  await saveJob(record).catch((e) => app.log.error(e, 'saveJob failed'));

  // The music is made while the segments render, and waited for only at the stitch.
  const musicBed = makeMusicBed(brief, jobId, cost.totalSeconds / clampPace(brief.pace) + (brief.endCardOn ? 3 : 0));
  const { references, carRefs, actorRef, placeRef, videoRefs, dealerLogo, brandLogo } =
    await loadBriefAssets(brief);
  const scenePlan = buildPrompt(brief, { sceneOverrides: req.body?.sceneOverrides })?.scenePlan ?? null;
  /** What each part was actually shown, kept on the record so a wrong car is traceable. */
  const sentRefs: { part: number; files: string[] }[] = parts.map((p) => ({ part: p.partNum, files: [] }));
  /** What the checker made of the vehicle in each part. */
  const vehicleChecks: { part: number; same: boolean; why: string; remade?: boolean }[] = [];
  /** What each join measured once the dead air was taken out of it. */
  let joins: { part: number; headTrim: number; tailTrim: number; echo?: number }[] = [];
  /** Retakes cost money, so a run buys at most this many of them. */
  let retakesLeft = 2;

  // No `extend` — each segment is an independent create, seeded with the
  // PREVIOUS segment's last frame so the presenter / car / setting stay
  // identical across the cut. All segments are ffmpeg-stitched into one video.
  // On a model that renders the whole duration in one call (Seedance 2.5 does
  // 30s) there is only ever one segment, and none of this applies.
  try {
    /*
     * The parts are made at the same time, not one after another.
     *
     * They used to queue because each one was seeded with the previous part's
     * last frame — part three could not start until part two existed. Now every
     * part is a reference task built from the same photographs, so nothing in
     * part three depends on part two having finished. Measured over twelve runs,
     * the provider is 89% of the wall clock and a part takes about a minute
     * whatever its length: five parts in a row is five minutes, five parts at
     * once is one.
     *
     * A few at a time rather than all at once, because Omni rate-limits hard and
     * a 429 costs more in backoff than the queueing saved.
     */
    const LANES = Math.max(1, Number(process.env.PARALLEL_PARTS) || 5);
    const made: (Buffer | null)[] = parts.map(() => null);
    let stopped = false;

    const renderOne = async (i: number): Promise<void> => {
      // A provider cannot be interrupted mid-render, so Stop is honoured between
      // parts: whatever is already made is kept and stitched.
      if (await stopRequested(jobId)) {
        stopped = true;
        return;
      }
      const part = parts[i]!;
      const isFirst = i === 0;

      // The photos of the vehicle this part frames — the cabin shot for a cabin
      // scene, the rear for a rear scene — rather than whatever came first.
      const partCars: LabelledRef[] = carRefsForPart(part, scenePlan, brief, req.body?.sceneOverrides, carRefs);
      // The storyboard's own frames for these scenes, when they were drawn.
      const partFrames = await framesForPart(part, scenePlan, req.body?.sceneOverrides);
      // And the room this part is set in, rather than the same photograph every time.
      const partShots = (scenePlan?.scenes ?? [])
        .filter((sc) => sc.end > part.start && sc.start < part.end)
        .map((sc) => (req.body?.sceneOverrides?.[sc.beat.key ?? '']?.shot ?? sc.beat.shot) || '')
        .join(' ');
      const partPlace = placeRefsFor(partShots, references.filter((r) => r !== actorRef))[0] ?? placeRef;
      sentRefs[i] = {
        part: part.partNum,
        files: [...partFrames.map((r) => r.filename), ...partCars.map((r) => r.filename)],
      };

      const renderStart = Date.now();
      const ask = (): Promise<{ bytes: Buffer; interactionId: string; renderResolution: Resolution }> =>
        renderSegment(resolved, {
          prompt: isFirst ? part.text : part.continuationText || part.text,
          aspect: brief.aspect,
          duration: part.duration,
          resolution: wanted,
          frames: partFrames,
          carRefs: partCars,
          actorRef,
          placeRef: partPlace,
          references,
          videoRefs,
        });
      let { bytes, interactionId } = await ask();
      let remadeHere = false;

      /*
       * Look at what came back before the film is built on it.
       *
       * The model is held to the vehicle by photographs, and mostly that works —
       * but "mostly" is not good enough at ₹300–1,000 a film. One frame is
       * compared against the reference photograph, and a clear mismatch is made
       * again. The judgement and the retake are both on the record.
       */
      if (partCars.length && brief.carModel && resolved.provider === 'google-gemini') {
        const frame = await posterFrame(bytes, Math.min(2.5, part.duration * 0.5)).catch(() => null);
        const refPhoto = partCars[0]?.ref.data ? Buffer.from(partCars[0]!.ref.data!, 'base64') : null;
        if (frame && refPhoto) {
          const verdict = await checkVehicleFrame(frame, refPhoto, brief.carModel, resolved.apiKey);
          if (verdict.checked) {
            const remade = !verdict.same && retakesLeft > 0;
            vehicleChecks.push({ part: part.partNum, same: verdict.same, why: verdict.why, remade });
            if (remade) {
              remadeHere = true;
              retakesLeft -= 1;
              app.log.warn(
                { jobId, part: part.partNum, why: verdict.why },
                'wrong vehicle on screen — making this part again',
              );
              const second = await ask();
              bytes = second.bytes;
              interactionId = second.interactionId;
            }
          }
        }
      }

      const storagePath = await uploadClip(jobId, part.partNum, bytes, 'video/mp4');
      clips[i] = {
        ...clips[i]!,
        interactionId,
        storagePath,
        status: 'done',
        renderMs: Date.now() - renderStart,
        remade: remadeHere || undefined,
        images: Math.min(
          resolved.maxReferenceImages ?? 10,
          partFrames.length + partCars.length + (actorRef ? 1 : 0) + (partPlace ? 1 : 0),
        ),
      };
      made[i] = bytes;
      // Written as each one lands, so History shows the film filling in.
      await updateJob(jobId, { clips }).catch(() => {});
    };

    // Lanes: each takes the next part that nobody has started.
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(LANES, parts.length) }, async () => {
        for (;;) {
          const i = next++;
          if (i >= parts.length || stopped) return;
          await renderOne(i);
        }
      }),
    );

    /*
     * Put them back in part order, whatever order they came back in.
     *
     * A stop keeps the run of parts from the beginning — a film that ends early
     * is watchable, one with a hole in the middle is not — and anything else
     * missing is a failure, not a shorter film.
     */
    const firstGap = made.findIndex((b) => !b);
    const usable = firstGap === -1 ? made.length : firstGap;
    if (!stopped && usable < parts.length) {
      throw new OmniFlashError('segment-missing', `Part ${usable + 1} did not come back; nothing was stitched.`);
    }
    const segmentBytes = made.slice(0, usable).filter((b): b is Buffer => Boolean(b));
    // Written from several lanes at once, so both are put in order before saving.
    sentRefs.sort((a, b) => a.part - b.part);
    vehicleChecks.sort((a, b) => a.part - b.part);

    if (stopped && !segmentBytes.length) {
      await updateJob(jobId, {
        ...record,
        status: 'cancelled',
        cancelRequested: false,
        clips,
        costInr: 0,
        costUsd: 0,
        totalSeconds: 0,
        error: 'Stopped before the first part finished.',
        finishedAt: Date.now(),
      });
      return { jobId, status: 'cancelled' as const, cost, clips: clipsForClient(jobId, clips) };
    }

    // Post-production: join the segments, lay one continuous music track under
    // them, append a real end card, and overlay the footer bar + logos.
    // Everything that must be legible is drawn here rather than generated.
    const bed = await musicBed;
    const overlay = buildOverlay(brief, req.body?.sceneOverrides, dealerLogo, brandLogo, bed?.bytes);
    const captured: { layers?: ComposedLayers; speech?: SpeechSpan[] } = {};
    const finalBytes = await composeFinal(segmentBytes, {
      ...overlay,
      findPeople: await peopleFinder(),
      onJoins: (n) => {
        joins = n;
      },
      onLayers: (l) => {
        captured.layers = l;
      },
      onSpeech: (sp) => {
        captured.speech = sp;
      },
    });
    const finalStoragePath = await uploadClip(jobId, 0, finalBytes, 'video/mp4'); // part 0 = final

    // Thumbnail for the project's generation history.
    let posterPath: string | undefined;
    const poster = await posterFrame(finalBytes).catch(() => null);
    if (poster) {
      const put = await putRef(`poster-${jobId}.jpg`, 'image/jpeg', poster).catch(() => null);
      posterPath = put?.storagePath;
    }

    // Billed on what rendered, not what was planned: a stopped run for the parts it
    // made, every part for the seconds its model renders, remakes twice.
    const billed = billClips(resolved.modelId, usdPerSecond, clips, record.prompts, plannedRes.render);

    const keptLayers = captured.layers
      ? await storeLayers(jobId, captured.layers, await filmMusic(bed, overlay, captured.speech)).catch((e) => {
          app.log.warn({ err: (e as Error).message, jobId }, 'keeping the layers failed');
          return undefined;
        })
      : undefined;

    // The whole record again, not just what changed: if the first save was lost,
    // this write alone still files the video under its project.
    await updateJob(jobId, {
      ...record,
      status: stopped ? 'cancelled' : 'done',
      cancelRequested: false,
      clips,
      referenceFiles: sentRefs,
      vehicleChecks,
      joins,
      layers: keptLayers,
      finalStoragePath,
      posterPath,
      musicStoragePath: bed?.storagePath,
      costInr: billed.inr,
      costUsd: billed.usd,
      totalSeconds: renderedSeconds(clips),
      error: stopped ? `Stopped after ${made.length} of ${parts.length} parts. What was made is kept.` : undefined,
      finishedAt: Date.now(),
    });
    if (req.caller) {
      await recordActivity(req.caller, {
        type: 'generate',
        detail: `${cost.totalSeconds}s · ${brief.aspect} · ${resolved.label}`,
        projectId: req.body?.projectId,
        projectName: req.body?.projectName,
        costInr: billed.inr,
      });
    }

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
          totalCostInr: (proj.totalCostInr ?? 0) + billed.inr,
          lastJobId: jobId,
          lastFinalUrl: `/api/clips/${jobId}/final`,
          status: 'generated',
        }).catch(() => {});
      }
    }
    return {
      jobId,
      status: stopped ? ('cancelled' as const) : ('done' as const),
      cost,
      finalUrl: `/api/clips/${jobId}/final`,
      clips: clipsForClient(jobId, clips),
    };
  } catch (err) {
    const e = err as OmniFlashError | SeedanceError | VeoError;
    app.log.error(
      { jobId, model: resolved?.modelId, code: e.code, message: e.message, detail: (e as OmniFlashError).detail },
      'generation failed',
    );
    if (e.code === 'daily-limit' && resolved?.modelId) await markExhausted(resolved.modelId).catch(() => {});
    const failedIdx = clips.findIndex((c) => c.status === 'pending');
    if (failedIdx >= 0) clips[failedIdx] = { ...clips[failedIdx]!, status: 'failed', error: e.message };
    // Bill what actually rendered, not what was planned. A run that dies on
    // segment 2 of 3 was quoted the full duration up front; leaving that
    // estimate on the record overstates the job in history and the project's
    // spend total.
    const spent = billClips(resolved.modelId, usdPerSecond, clips, record.prompts, plannedRes.render);
    await updateJob(jobId, {
      ...record,
      status: 'failed',
      error: e.message,
      clips,
      costInr: spent.inr,
      costUsd: spent.usd,
      totalSeconds: renderedSeconds(clips),
    }).catch(() => {});
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
    return reply.code(e instanceof OmniFlashError || e instanceof SeedanceError || e instanceof VeoError ? e.status : 502).send({
      code: e.code ?? 'generate-failed',
      message: e.message,
      jobId,
      finalUrl,
      clips: clipsForClient(jobId, clips),
    });
  }
});

/** Has Stop been pressed on this run? Read between parts, never mid-render. */
async function stopRequested(jobId: string): Promise<boolean> {
  return Boolean((await getJob(jobId).catch(() => null))?.cancelRequested);
}

/**
 * Stop a run.
 *
 * No provider can be interrupted mid-render — the seconds are already being paid for —
 * so this asks the run to stop after the part it is on. What is already made is stitched
 * and kept, and the parts that never ran can be picked up afterwards as a retake.
 */
app.post<{ Params: { jobId: string } }>('/api/generate/:jobId/stop', async (req, reply) => {
  const job = await getJob(req.params.jobId);
  if (!job) return reply.code(404).send({ code: 'not-found', message: 'No such job' });
  if (job.status !== 'running') return { ok: true, status: job.status };
  await updateJob(req.params.jobId, { cancelRequested: true });
  return { ok: true, status: 'stopping' as const };
});

app.get<{ Params: { jobId: string } }>('/api/generate/:jobId', async (req, reply) => {
  const job = await getJob(req.params.jobId);
  if (!job) return reply.code(404).send({ code: 'not-found', message: 'No such job' });
  const finalUrl = job.finalStoragePath ? `/api/clips/${job.jobId}/final` : undefined;
  // A viewer follows a run to watch it — not to read its prompts, its brief or what it cost.
  if (!allows(req.caller ?? null, 'creator')) {
    return {
      jobId: job.jobId,
      status: job.status,
      finalUrl,
      clips: clipsForClient(job.jobId, job.clips).map((c) => ({ ...c, error: undefined })),
    };
  }
  const withoutCost = allows(req.caller ?? null, 'admin')
    ? {}
    : { costInr: undefined, costUsd: undefined, costInrBefore: undefined, usdPerSecond: undefined };
  return { ...job, ...withoutCost, finalUrl, clips: clipsForClient(job.jobId, job.clips) };
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
  /** Images attached to the retake — what the vehicle must look like in the parts redone. */
  attachments?: { storagePath?: string; refId?: string; label?: string }[];
  modelId?: string;
  projectId?: string;
  projectName?: string;
  confirmedCostInr?: number;
  sceneOverrides?: Record<string, SceneOverride>;
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
    const usdPerSecond = resolved
      ? priceFor(
          {
            modelId: resolved.modelId,
            usdPerSecond: resolved.usdPerSecond,
            usdPerSecondByResolution: resolved.usdPerSecondByResolution,
            resolutions: resolved.resolutions ?? ['720p'],
          },
          wantedResolution(brief),
        )
      : (source.usdPerSecond ?? config.usdPerSecond);
    const redoSeconds = parts
      .filter((p) => redo.includes(p.partNum))
      .reduce((a, p) => a + p.duration, 0);
    const cost = estimateSegmentsCost(redoSeconds, redo.length, { usdPerSecond });
    if (cost.needsConfirmation && (req.body?.confirmedCostInr ?? 0) < cost.inr) {
      return reply.code(428).send({
        code: 'cost-confirmation-required',
        message: 'This run is over the ₹500 approval threshold — approve the spend and send it again.',
        ...(allows(req.caller ?? null, 'admin') ? { cost } : {}),
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
      userId: req.caller?.uid,
      userEmail: req.caller?.email,
      userName: req.caller?.name,
      parentJobId: source.jobId,
      refinedParts: redo,
      feedback: feedback || undefined,
      projectId: req.body?.projectId ?? source.projectId,
      projectName: req.body?.projectName ?? source.projectName,
      label: redo.length
        ? `Retake · segment${redo.length > 1 ? 's' : ''} ${redo.join(', ')} of ${parts.length}`
        : 'Restitch · overlays only',
      modelName: resolved?.label ?? source.modelName,
      modelId: resolved?.modelId,
      status: 'running',
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      categories: brief.categories,
      dealerName: brief.dealer.dealerName,
      aspect: brief.aspect,
      resolution: wantedResolution(brief),
      totalSeconds: Math.round(totalSeconds * 10) / 10,
      costInr: cost.inr,
      costUsd: cost.usd,
      usdPerSecond,
      clips,
      brief: { ...brief, attachments: (brief.attachments ?? []).map(({ src, ...rest }) => rest) },
      sceneEdits: req.body?.sceneOverrides,
    };
    await saveJob(record).catch((e) => app.log.error(e, 'saveJob failed'));

    // The same music goes back under the new cut. A run made before the bed existed
    // carries its music inside the clips, so it only gets one when every segment is
    // being made again.
    const musicBed: Promise<{ bytes: Buffer; storagePath?: string } | null> = source.musicStoragePath
      ? readObject(source.musicStoragePath)
          .then((o) => (o ? { bytes: o.bytes, storagePath: source.musicStoragePath } : null))
          .catch(() => null)
      : redo.length === parts.length
        ? makeMusicBed(brief, jobId, totalSeconds / clampPace(brief.pace) + (brief.endCardOn ? 3 : 0))
        : Promise.resolve(null);
    const { references, carRefs, actorRef, placeRef, videoRefs, dealerLogo, brandLogo } =
      await loadBriefAssets(brief);
    const scenePlan = buildPrompt(brief, { sceneOverrides: req.body?.sceneOverrides })?.scenePlan ?? null;
    // Images attached to this retake: "the car is wrong in these frames — here is the car".
    const attached: LabelledRef[] = [];
    for (const [i, a] of (req.body?.attachments ?? []).entries()) {
      const obj = a.storagePath ? await readObject(a.storagePath).catch(() => null) : null;
      if (obj) {
        attached.push({
          ref: { data: obj.bytes.toString('base64'), mimeType: obj.contentType || 'image/jpeg', kind: 'image' },
          label: 'attached with this retake — the vehicle it must show',
          filename: a.storagePath?.split('/').pop() ?? `retake-${i + 1}.jpg`,
        });
      }
    }

    try {
      const segmentBytes: Buffer[] = [];
      let prevBytes: Buffer | null = null;
      let anchorFrame: Buffer | undefined;

      for (let i = 0; i < parts.length; i++) {
        // Stopping a retake abandons it: the video it was refining is untouched.
        if (await stopRequested(jobId)) {
          await updateJob(jobId, {
            ...record,
            status: 'cancelled',
            cancelRequested: false,
            clips,
            error: 'Stopped during the retake. The video it was refining is untouched.',
            finishedAt: Date.now(),
          }).catch(() => {});
          return { jobId, status: 'cancelled' as const, cost, clips: clipsForClient(jobId, clips) };
        }
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
          const renderStart = Date.now();
          const rendered = await renderSegment(resolved!, {
            prompt: applyFeedback(isFirst ? part.text : part.continuationText || part.text, feedback, attached.length),
            aspect: brief.aspect,
            duration: part.duration,
            resolution: wantedResolution(brief),
            seedFrame,
            anchorFrame,
            // The storyboard's frame for these scenes still says how they are shot,
            // unless the retake itself came with a picture.
            frames: attached.length ? [] : await framesForPart(part, scenePlan, req.body?.sceneOverrides),
            // An image attached to the retake outranks even the project's vehicle photos.
            carRefs: attached.length
              ? attached
              : carRefsForPart(part, scenePlan, brief, req.body?.sceneOverrides, carRefs),
            actorRef,
            placeRef,
            references: attached.length ? [...attached, ...references] : references,
            videoRefs,
          });
          bytes = rendered.bytes;
          clips[i] = {
            ...clips[i]!,
            interactionId: rendered.interactionId,
            storagePath: await uploadClip(jobId, part.partNum, bytes, 'video/mp4'),
            status: 'done',
            renderMs: Date.now() - renderStart,
          };
        }

        await updateJob(jobId, { clips });
        segmentBytes.push(bytes);
        prevBytes = bytes;
        // The vehicle as this film already showed it, for the parts that follow.
        if (i === 0) anchorFrame = (await posterFrame(bytes, Math.min(3, part.duration * 0.6))) ?? undefined;
      }

      // Overlay copy is rebuilt from the current brief, so a footer or end-card
      // correction lands here even on the free restitch path.
      const bed = await musicBed;
      const overlay = buildOverlay(brief, req.body?.sceneOverrides, dealerLogo, brandLogo, bed?.bytes);
      const captured: { layers?: ComposedLayers; speech?: SpeechSpan[] } = {};
      const finalBytes = await composeFinal(segmentBytes, {
        ...overlay,
        findPeople: await peopleFinder(),
        onLayers: (l) => {
          captured.layers = l;
        },
        onSpeech: (sp) => {
          captured.speech = sp;
        },
      });
      const finalStoragePath = await uploadClip(jobId, 0, finalBytes, 'video/mp4'); // part 0 = final

      let posterPath: string | undefined;
      const poster = await posterFrame(finalBytes).catch(() => null);
      if (poster) {
        posterPath = (await putRef(`poster-${jobId}.jpg`, 'image/jpeg', poster).catch(() => null))?.storagePath;
      }

      const keptLayers = captured.layers
        ? await storeLayers(jobId, captured.layers, await filmMusic(bed, overlay, captured.speech)).catch((e) => {
            app.log.warn({ err: (e as Error).message, jobId }, 'keeping the layers failed');
            return undefined;
          })
        : undefined;

      // Only the segments made again are billed, for the seconds they rendered.
      const billed = billClips(
        resolved?.modelId,
        usdPerSecond,
        clips,
        parts.map((p) => ({ part: p.partNum, text: p.text })),
        resolved
          ? renderResolution(resolved.modelId, wantedResolution(brief), resolved.resolutions).render
          : wantedResolution(brief),
      );
      await updateJob(jobId, {
        ...record,
        status: 'done',
        clips,
        costInr: billed.inr,
        costUsd: billed.usd,
        finalStoragePath,
        posterPath,
        musicStoragePath: bed?.storagePath,
        layers: keptLayers,
        finishedAt: Date.now(),
      });
      if (req.caller) {
        await recordActivity(req.caller, {
          type: 'retake',
          detail: redo.length ? `segments ${redo.join(', ')} of ${parts.length}` : 'restitch only',
          projectId: req.body?.projectId ?? source.projectId,
          projectName: req.body?.projectName ?? source.projectName,
          costInr: billed.inr,
        });
      }

      const projectId = req.body?.projectId ?? source.projectId;
      if (projectId) {
        const proj = await getOne<{ generationCount?: number; totalCostInr?: number }>('projects', projectId);
        if (proj) {
          await patch('projects', projectId, {
            generationCount: (proj.generationCount ?? 0) + 1,
            totalCostInr: (proj.totalCostInr ?? 0) + billed.inr,
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
      const e = err as OmniFlashError | SeedanceError | VeoError;
      app.log.error(
        { jobId, model: resolved?.modelId, code: e.code, message: e.message, detail: (e as OmniFlashError).detail },
        'generation failed',
      );
      if (e.code === 'daily-limit' && resolved?.modelId) await markExhausted(resolved.modelId).catch(() => {});
      const failedIdx = clips.findIndex((c) => c.status === 'pending');
      if (failedIdx >= 0) clips[failedIdx] = { ...clips[failedIdx]!, status: 'failed', error: e.message };
      await updateJob(jobId, { ...record, status: 'failed', error: e.message, clips }).catch(() => {});
      return reply.code(e instanceof OmniFlashError || e instanceof SeedanceError || e instanceof VeoError ? e.status : 502).send({
        code: e.code ?? 'refine-failed',
        message: e.message,
        jobId,
        clips: clipsForClient(jobId, clips),
      });
    }
  },
);

/**
 * One run, in full: the brief it was made from, the prompt each part was given,
 * and the reference images each part was shown. This is what answers "why is the
 * car wrong in this one and right in that one" without guessing.
 */
/**
 * A version of a film that already exists.
 *
 * Nothing here generates a new film. The approved cut is the one that ships, and
 * these are things done TO it — enlarged, re-rendered for finish, trimmed — each
 * saved as its own entry beside the original so neither replaces the other.
 */
/**
 * What a run's rendered parts cost: the seconds each model actually bills, a part made
 * again for the wrong vehicle twice, and on Omni the prompt and references as input.
 * Re-used parts cost nothing.
 */
function billClips(
  modelId: string | undefined,
  usdPerSecond: number,
  clips: JobClip[],
  prompts: { part: number; text: string }[] | undefined,
  resolution: Resolution,
): { inr: number; usd: number } {
  return renderCost(
    modelId,
    usdPerSecond,
    clips
      .filter((c) => c.status === 'done' && !c.reused)
      .map((c) => ({
        seconds: c.seconds,
        remade: c.remade,
        images: c.images,
        promptChars: prompts?.find((p) => p.part === c.partNum)?.text.length,
      })),
    { resolution },
  );
}

/**
 * A film's music as its layers keep it: the stored track, the level and dip it was mixed
 * with, where the voice is, and how loud the track itself is — what the editor's key
 * points and preview level start from.
 */
async function filmMusic(
  bed: { bytes: Buffer; storagePath?: string } | null | undefined,
  overlay: Pick<BrandOverlay, 'musicLoudness' | 'musicDuckDb'>,
  speech: SpeechSpan[] | undefined,
): Promise<FilmMusicLayer | undefined> {
  if (!bed?.storagePath) return undefined;
  return {
    storagePath: bed.storagePath,
    loudness: overlay.musicLoudness ?? -20,
    duckDb: overlay.musicDuckDb ?? 0,
    ...(speech ? { speech } : {}),
    measured: await measureLoudness(bed.bytes),
  };
}

/** A composed film's layers, with the logo artwork it drew saved, so an edit draws the same pixels. */
async function storeLayers(jobId: string, composed: ComposedLayers, music?: FilmMusicLayer): Promise<FilmLayers> {
  const logos: FilmLogoLayer[] = [];
  for (const g of composed.logos) {
    const colour = await putRef(`logo-${g.which}-${jobId}.png`, 'image/png', g.colour);
    const white = g.white ? await putRef(`logo-${g.which}-white-${jobId}.png`, 'image/png', g.white) : null;
    logos.push({ which: g.which, x: g.x, y: g.y, w: g.w, h: g.h, colourPath: colour.storagePath, ...(white ? { whitePath: white.storagePath } : {}), whiteOnEndCard: g.whiteOnEndCard });
  }
  return { ...composed, logos, ...(music ? { music } : {}) };
}

function layersReply(jobId: string, layers: FilmLayers, note?: string) {
  return {
    mode: 'layers' as const,
    layers,
    cleanUrl: `/api/clips/${jobId}/clean`,
    musicUrl: layers.music ? `/api/${layers.music.storagePath}` : null,
    ...(note ? { note } : {}),
  };
}

/**
 * Layers whose music is missing what its key points start from, given it: where the voice
 * is (`speech`, heard on the film's parts) and the track's own loudness. Measured once —
 * a track that cannot be measured is kept as null rather than tried on every open.
 */
async function withMusicFacts(layers: FilmLayers, speech: SpeechSpan[] | undefined): Promise<FilmLayers> {
  const m = layers.music;
  if (!m) return layers;
  const measured =
    m.measured !== undefined ? m.measured : await readObject(m.storagePath).then((o) => (o ? measureLoudness(o.bytes) : null)).catch(() => null);
  return { ...layers, music: { ...m, measured, ...(!m.speech && speech ? { speech } : {}) } };
}

async function prepareLayers(
  job: JobRecord,
  plan: Extract<EditOpenPlan, 'music' | 'clean' | 'rebuild'>,
  body: { brief?: Brief; sceneOverrides?: Record<string, SceneOverride> },
) {
  const segmentBytes = () =>
    Promise.all(
      [...job.clips]
        .sort((a, b) => a.partNum - b.partNum)
        .map(async (c) => {
          const o = await readObject(c.storagePath);
          if (!o) throw new Error(`part ${c.partNum} is missing from storage`);
          return o.bytes;
        }),
    );
  if (plan === 'music') {
    // Footage and layers are kept; only the music's facts are missing. Never worth failing an open over.
    const kept = job.layers!;
    try {
      const hear = kept.music && kept.music.duckDb < 0 && !kept.music.speech && segmentsKept(job);
      const speech = hear ? await filmSpeech(await segmentBytes(), kept.speed) : undefined;
      const layers = await withMusicFacts(kept, speech);
      await updateJob(job.jobId, { layers });
      return layersReply(job.jobId, layers);
    } catch (err) {
      app.log.warn({ err: (err as Error).message, jobId: job.jobId }, "working out the music's key points failed");
      return layersReply(job.jobId, kept);
    }
  }
  const segments = await segmentBytes();
  const heard: { speech?: SpeechSpan[] } = {};
  const onSpeech = (sp: SpeechSpan[]): void => {
    heard.speech = sp;
  };
  if (plan === 'clean') {
    const { bytes } = await composeClean(segments, { speed: job.layers!.speed, targetShortSide: job.layers!.targetShortSide, onSpeech }, { plan: false });
    const cleanStoragePath = await uploadCleanCut(job.jobId, bytes);
    const layers = await withMusicFacts(job.layers!, heard.speech);
    await updateJob(job.jobId, { cleanStoragePath, layers });
    return layersReply(job.jobId, layers);
  }
  const brief = (job.brief as Brief | undefined) ?? body.brief;
  if (!brief) throw new Error('this film kept no record of its settings, and none were sent');
  const sceneOverrides = (job.brief ? job.sceneEdits : body.sceneOverrides) as Record<string, SceneOverride> | undefined;
  const { dealerLogo, brandLogo } = await loadBriefAssets(brief);
  const overlay = { ...buildOverlay(brief, sceneOverrides, dealerLogo, brandLogo), findPeople: await peopleFinder(), onSpeech };
  const { bytes, layers: composed } = await composeClean(segments, overlay);
  if (!composed) throw new Error('no layers were worked out');
  const cleanStoragePath = await uploadCleanCut(job.jobId, bytes);
  const stored = await storeLayers(
    job.jobId,
    composed,
    job.musicStoragePath ? { storagePath: job.musicStoragePath, loudness: overlay.musicLoudness ?? -20, duckDb: overlay.musicDuckDb ?? 0 } : undefined,
  );
  const layers = await withMusicFacts(stored, heard.speech);
  await updateJob(job.jobId, { cleanStoragePath, layers });
  return layersReply(job.jobId, layers, job.brief ? undefined : 'This film was made before layers were kept, so they were rebuilt from the project as it is now.');
}

/** One layers build per film at a time: a second open of the same film waits for the first. */
const layerBuilds = new Map<string, ReturnType<typeof prepareLayers>>();

/**
 * Open a film in the video editor as layers.
 *
 * The first time, its clean footage is made from its segments — about as long as a
 * restitch, and free. A version exported from the editor reopens as that edit; a version
 * that kept no segments opens as the finished picture.
 */
app.post<{ Params: { jobId: string }; Body: { brief?: Brief; sceneOverrides?: Record<string, SceneOverride> } }>(
  '/api/generations/:jobId/layers',
  async (req, reply) => {
    const job = await getJob(req.params.jobId);
    if (!job) return reply.code(404).send({ code: 'not-found', message: 'No such film.' });
    const plan = editOpenPlan(job);
    const creator = allows(req.caller ?? null, 'creator');
    if (plan === 'edit') return { mode: 'edit' as const, editProject: await withMusicLine(job.editProject!, creator) };
    if (plan === 'ready' || (plan === 'music' && !creator)) return layersReply(job.jobId, job.layers!);
    if (plan === 'flat') {
      return reply.code(409).send({
        code: 'flat',
        message: 'This version was saved from a finished film, so its captions and logos are part of the picture. Open the film it was made from to edit them as layers.',
      });
    }
    if (!creator) {
      return reply.code(409).send({ code: 'flat', message: 'This film has not been prepared for layers yet. It is prepared the first time a creator opens it in the editor.' });
    }
    try {
      return await buildLayers(job, plan, req.body ?? {});
    } catch (err) {
      app.log.error({ err: (err as Error).message, jobId: job.jobId }, 'preparing layers failed');
      return reply.code(409).send({ code: 'flat', message: `The layers could not be prepared: ${(err as Error).message.slice(0, 200)}.` });
    }
  },
);

function buildLayers(job: JobRecord, plan: Parameters<typeof prepareLayers>[1], body: Parameters<typeof prepareLayers>[2]) {
  const running = layerBuilds.get(job.jobId) ?? prepareLayers(job, plan, body);
  if (!layerBuilds.has(job.jobId)) {
    layerBuilds.set(job.jobId, running);
    void running.catch(() => {}).finally(() => layerBuilds.delete(job.jobId));
  }
  return running;
}

/**
 * A saved edit whose music has no volume line — exported before lines existed — given the
 * dips of the film it was cut from, so it reopens with key points like any other. The film's
 * voice is worked out first if it never was, when a creator is opening it.
 */
async function withMusicLine(project: EditProject, creator: boolean): Promise<EditProject> {
  if (!project.clips.some((c) => c.bed && !c.gain)) return project;
  try {
    const source = project.clips.find((c) => c.source?.type === 'video' && c.source.variant === 'clean')?.source;
    const film = source?.type === 'video' && source.jobId ? await getJob(source.jobId) : null;
    if (!film?.layers) return project;
    const layers = creator && editOpenPlan(film) === 'music' ? (await buildLayers(film, 'music', {})).layers : film.layers;
    return editWithFilmMusicLine(project, layers);
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, "giving a saved edit's music its key points failed");
    return project;
  }
}

/** How long the film that came back runs: every part made, re-used ones included. */
const renderedSeconds = (clips: JobClip[]): number =>
  Math.round(clips.filter((c) => c.status === 'done').reduce((a, c) => a + (c.seconds ?? 0), 0) * 10) / 10;

async function saveDerived(
  source: JobRecord,
  bytes: Buffer,
  opts: {
    kind: NonNullable<JobRecord['kind']>;
    label: string;
    note: string;
    caller?: { uid?: string; email?: string; name?: string };
    costInr?: number;
    costUsd?: number;
    resolution?: string;
    modelName?: string;
    modelId?: string;
    editProject?: EditProject;
  },
): Promise<JobRecord> {
  const jobId = randomUUID();
  const now = Date.now();
  const finalStoragePath = await uploadClip(jobId, 0, bytes, 'video/mp4');
  let posterPath: string | undefined;
  const poster = await posterFrame(bytes).catch(() => null);
  if (poster) posterPath = (await putRef(`poster-${jobId}.jpg`, 'image/jpeg', poster).catch(() => null))?.storagePath;
  const facts = await videoFacts(bytes).catch(() => ({ duration: source.totalSeconds ?? 0 }));

  const record: JobRecord = {
    ...source,
    jobId,
    kind: opts.kind,
    derivedFrom: source.jobId,
    derivedNote: opts.note,
    parentJobId: source.jobId,
    approved: false,
    approvedAt: undefined,
    label: opts.label,
    status: 'done',
    createdAt: now,
    startedAt: now,
    finishedAt: now,
    updatedAt: now,
    clips: [],
    refinedParts: undefined,
    feedback: undefined,
    userId: opts.caller?.uid,
    userEmail: opts.caller?.email,
    userName: opts.caller?.name,
    costInr: opts.costInr ?? 0,
    costUsd: opts.costUsd ?? 0,
    totalSeconds: Math.round(facts.duration ?? source.totalSeconds ?? 0),
    resolution: opts.resolution ?? source.resolution,
    renderResolution: undefined,
    modelName: opts.modelName ?? source.modelName,
    modelId: opts.modelId ?? source.modelId,
    finalStoragePath,
    posterPath,
    error: undefined,
    // A version's pixels are its own: the film's layers describe the film, not this.
    layers: undefined,
    cleanStoragePath: undefined,
    editProject: opts.editProject,
  };
  await saveJob(record);
  if (record.projectId && (opts.costInr ?? 0) > 0) {
    const proj = await getOne<{ generationCount?: number; totalCostInr?: number }>('projects', record.projectId);
    if (proj) {
      await patch('projects', record.projectId, {
        totalCostInr: (proj.totalCostInr ?? 0) + (opts.costInr ?? 0),
      }).catch(() => {});
    }
  }
  return record;
}

/**
 * Take a run out of history, and out of what the team has spent.
 *
 * Nothing is deleted: the record, its video and its receipt all stay, and an
 * admin can put it back. What changes is what is counted — the project's spend,
 * the person's running total, and whether anyone but an admin sees the run at
 * all. A failed run on depleted credits is the case this exists for.
 */
app.post<{ Params: { jobId: string }; Body: { hidden?: boolean } }>(
  '/api/generations/:jobId/hide',
  async (req, reply) => {
    const job = await getJob(req.params.jobId);
    if (!job) return reply.code(404).send({ code: 'not-found', message: 'No such generation' });
    const hidden = req.body?.hidden !== false;
    if (Boolean(job.hidden) === hidden) return { ok: true, hidden };

    await updateJob(req.params.jobId, {
      hidden,
      hiddenAt: hidden ? Date.now() : undefined,
      hiddenBy: hidden ? req.caller?.email : undefined,
    });

    // The counters the app reads without scanning the log follow it.
    const cost = Math.round(job.costInr ?? 0);
    const sign = hidden ? -1 : 1;
    if (job.projectId) {
      const proj = await getOne<{ generationCount?: number; totalCostInr?: number }>('projects', job.projectId);
      if (proj) {
        await patch('projects', job.projectId, {
          generationCount: Math.max(0, (proj.generationCount ?? 0) + sign),
          totalCostInr: Math.max(0, (proj.totalCostInr ?? 0) + sign * cost),
        }).catch(() => {});
      }
    }
    await uncountRun(job.userId, hidden ? cost : -cost, hidden ? 1 : -1).catch(() => {});
    return { ok: true, hidden };
  },
);

/** The film the client signed off. Only one version of a project holds it. */
app.post<{ Params: { jobId: string }; Body: { approved?: boolean } }>(
  '/api/generations/:jobId/approve',
  async (req, reply) => {
    const job = await getJob(req.params.jobId);
    if (!job) return reply.code(404).send({ code: 'not-found', message: 'No such generation' });
    const approved = req.body?.approved !== false;
    if (approved && job.projectId) {
      // One approved cut per project: the last word, not a collection of them.
      const siblings = await listJobsForProject(job.projectId);
      for (const s of siblings) {
        if (s.approved && s.jobId !== job.jobId) await updateJob(s.jobId, { approved: false, approvedAt: undefined });
      }
    }
    await updateJob(req.params.jobId, { approved, approvedAt: approved ? Date.now() : undefined });
    return { ok: true, approved };
  },
);

/**
 * The approved film, larger. No model is involved: the pixels are the ones the
 * client already signed off, scaled up and sharpened a little. It cannot add
 * detail that was never rendered — for that, the premium pass re-renders.
 */
app.post<{ Params: { jobId: string }; Body: { resolution?: Resolution } }>(
  '/api/generations/:jobId/upscale',
  async (req, reply) => {
    const job = await getJob(req.params.jobId);
    if (!job?.finalStoragePath) {
      return reply.code(404).send({ code: 'not-found', message: 'No finished video on that run.' });
    }
    const want: Resolution = req.body?.resolution ?? '1080p';
    const obj = await readObject(job.finalStoragePath);
    if (!obj) return reply.code(404).send({ code: 'not-found', message: 'That video is gone from storage.' });
    try {
      const bytes = await upscaleVideo(obj.bytes, shortSideFor(want));
      const saved = await saveDerived(job, bytes, {
        kind: 'upscale',
        label: `Upscaled to ${want}`,
        note: `Scaled up from ${job.resolution ?? 'the original'} — the same film, no model involved.`,
        caller: req.caller,
        resolution: want,
      });
      return { jobId: saved.jobId, finalUrl: `/api/clips/${saved.jobId}/final` };
    } catch (err) {
      return reply.code(500).send({ code: 'upscale-failed', message: (err as Error).message });
    }
  },
);

/**
 * The premium pass: the approved film re-rendered by Seedance for finish.
 *
 * Omni writes and speaks the language; Seedance makes the better-looking picture.
 * So the film is made and approved on Omni, then passed through Seedance with one
 * instruction — change nothing, improve the rendering — and its own audio left
 * off, because the sound is already right — it is laid back over the new picture.
 * Seedance takes a limited length at a time, so a longer film goes through in pieces
 * split on its own cuts, all rendered at once, and joined again here.
 */
app.post<{ Params: { jobId: string }; Body: { modelId?: string } }>(
  '/api/generations/:jobId/enhance',
  async (req, reply) => {
    const job = await getJob(req.params.jobId);
    if (!job?.finalStoragePath) {
      return reply.code(404).send({ code: 'not-found', message: 'No finished video on that run.' });
    }
    const picked = await resolveModel(req.body?.modelId);
    if ('error' in picked) return reply.code(503).send({ code: picked.code, message: picked.error });
    if (picked.provider !== 'byteplus-ark') {
      return reply.code(400).send({
        code: 'wrong-model',
        message: 'The premium pass runs on Seedance — pick a Seedance model for it.',
      });
    }
    const obj = await readObject(job.finalStoragePath);
    if (!obj) return reply.code(404).send({ code: 'not-found', message: 'That video is gone from storage.' });

    const want = (job.resolution === '360p' ? '720p' : (job.resolution as Resolution)) ?? '720p';
    const { render } = renderResolution(picked.modelId, want, picked.resolutions);
    const seedanceRes = render === '360p' ? '480p' : render;

    const instruction = [
      'Re-render this video at a higher standard of finish. It is a finished television commercial that has already been approved.',
      '',
      'Change nothing about what happens. Same shots, same framing, same camera moves, same cuts and the same length.',
      'Same people: the same face, hair, clothes and expressions, doing exactly what they are doing.',
      'Same vehicle: the same model, generation, colour, wheels and badges, in the same position in every frame.',
      'Same location, same props, same on-screen text, same timing.',
      '',
      'What to improve, and only this: lighting quality and depth, material and surface detail — paint, chrome, glass, fabric, skin — focus, micro-contrast, colour depth and the overall filmic, premium look of a high-end car commercial.',
      'Do not restage, reframe, re-time, add or remove anything. Do not add text, logos, graphics or effects. Do not speed up or slow down.',
      // The one thing a pass may change: a plate the film drew with writing on it is
      // put right rather than preserved, since keeping it is keeping a misspelling.
      'Every number plate is a plain white plate with nothing on it. Never add writing to a plate, and where a plate in this video shows any letters or numbers, render that plate plain white and blank.',
    ].join('\n');

    try {
      const { duration } = await videoFacts(obj.bytes);
      // A second under the model's own ceiling: ModelArk rounds, and a length at the ceiling is refused.
      const ceiling = Math.max(5, Math.min(29, picked.maxClipSec - 1));
      const shortest = Math.max(4, picked.minClipSec);
      const cuts = await sceneCuts(obj.bytes).catch(() => [] as number[]);
      const base = `${String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0]}://${String(req.headers['x-forwarded-host'] ?? req.headers.host)}`;

      const passPiece = async (piece: Buffer, index: number, seconds: number): Promise<Buffer> => {
        const name = `enhance-${job.jobId}-${index + 1}.mp4`;
        const stored = await putRef(name, 'video/mp4', piece);
        // ModelArk fetches the video itself and takes nothing else: sent inline, every pass
        // was refused with "reference_video must be provided as a web url". A signed storage
        // link needs a permission the service account may not have, so where signing fails
        // the app's own reference route serves the piece, at an unguessable address.
        const url = (await signedUrlFor(stored.storagePath, 180)) ?? `${base}/api/refs/${stored.refId}/${safeRefName(name)}`;
        const out = await enhanceSeedanceClip(
          {
            prompt: instruction,
            model: picked.modelId,
            resolution: seedanceRes as '480p' | '720p' | '1080p',
            duration: seconds,
            videoUrl: url,
            mimeType: 'video/mp4',
          },
          picked.apiKey,
        );
        // Back to exactly the length it went in at, so the approved sound still lines up.
        return conformLength(out.bytes, seconds);
      };

      /** Every piece at once, three at a time, split on the film's own cuts. */
      const render = async (longest: number): Promise<Buffer[]> => {
        const bounds = pieceBounds(duration, cuts, longest, shortest);
        // Sent at the size it is rendered at: a 360p film is under Seedance's minimum, and
        // a reference no sharper than the render gives it nothing to work from.
        const pieces = await cutVideo(obj.bytes, bounds, seedanceRes === '1080p' ? 1080 : 720);
        const done: Buffer[] = new Array(pieces.length);
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(3, pieces.length) }, async () => {
            for (;;) {
              const i = next++;
              if (i >= pieces.length) return;
              done[i] = await passPiece(pieces[i]!, i, bounds[i + 1]! - bounds[i]!);
            }
          }),
        );
        return done;
      };

      let rendered: Buffer[];
      try {
        rendered = await render(ceiling);
      } catch (err) {
        const message = (err as Error).message ?? '';
        // A reference longer than ModelArk will take: the whole pass again, in pieces it will.
        if (ceiling > 14 && /duration|second|length|too long|exceed/i.test(message) && !/web url/i.test(message)) {
          rendered = await render(14);
        } else {
          throw err;
        }
      }
      const joined = await withSoundOf(await joinVideos(rendered), obj.bytes);
      const seconds = (await videoFacts(joined)).duration;
      const cost = estimateSegmentsCost(seconds, rendered.length, { usdPerSecond: picked.usdPerSecond });
      const saved = await saveDerived(job, joined, {
        kind: 'enhance',
        label: `Premium pass · ${picked.label}`,
        note: `Re-rendered for finish by ${picked.label} in ${rendered.length} piece${rendered.length === 1 ? '' : 's'}, split on the film's own cuts and rendered together; the cut, the people, the vehicle and the sound are the approved ones.`,
        caller: req.caller,
        costInr: cost.inr,
        costUsd: cost.usd,
        resolution: seedanceRes,
        modelName: picked.label,
        modelId: picked.modelId,
      });
      return { jobId: saved.jobId, finalUrl: `/api/clips/${saved.jobId}/final`, cost };
    } catch (err) {
      const e = err as SeedanceError;
      app.log.error({ jobId: job.jobId, code: e.code, message: e.message }, 'premium pass failed');
      return reply.code(502).send({ code: e.code ?? 'enhance-failed', message: e.message });
    }
  },
);

/**
 * The editor's export: the same film with stretches taken out, and optionally
 * silent. Nothing is generated, so it costs nothing and cannot drift.
 */
app.post<{
  Params: { jobId: string };
  Body: { keep?: { from: number; to: number }[]; mute?: boolean; note?: string; append?: string[] };
}>(
  '/api/generations/:jobId/edit',
  async (req, reply) => {
    const job = await getJob(req.params.jobId);
    if (!job?.finalStoragePath) {
      return reply.code(404).send({ code: 'not-found', message: 'No finished video on that run.' });
    }
    const keep = (req.body?.keep ?? []).filter((r) => Number.isFinite(r.from) && Number.isFinite(r.to));
    if (!keep.length) return reply.code(400).send({ code: 'bad-request', message: 'Nothing to keep.' });
    const obj = await readObject(job.finalStoragePath);
    if (!obj) return reply.code(404).send({ code: 'not-found', message: 'That video is gone from storage.' });
    try {
      let bytes = await keepRanges(obj.bytes, keep, { mute: req.body?.mute === true });
      // Other finished films from this project, joined on the end in the order given.
      const appended: string[] = [];
      for (const id of req.body?.append ?? []) {
        const other = await getJob(id);
        if (!other?.finalStoragePath) continue;
        const bits = await readObject(other.finalStoragePath);
        if (!bits) continue;
        bytes = await joinVideos([bytes, bits.bytes]);
        appended.push(other.label ?? id.slice(0, 8));
      }
      const saved = await saveDerived(job, bytes, {
        kind: 'edit',
        label: req.body?.note?.trim() || 'Edited cut',
        note:
          `Kept ${keep.map((r) => `${r.from.toFixed(1)}–${r.to.toFixed(1)}s`).join(', ')}` +
          (req.body?.mute ? ', silent' : '') +
          (appended.length ? `, then ${appended.join(', then ')}` : '') +
          '.',
        caller: req.caller,
        resolution: job.resolution,
      });
      return { jobId: saved.jobId, finalUrl: `/api/clips/${saved.jobId}/final` };
    } catch (err) {
      return reply.code(400).send({ code: 'edit-failed', message: (err as Error).message });
    }
  },
);

/**
 * Export a video editor project.
 *
 * Rendered with ffmpeg on this server and saved as a new version of the first of
 * the project's films on the main track, so it lands in that project's history
 * beside the film it was cut from — which is untouched. Only the project's own
 * films and this app's own uploads can be read into an edit, never an arbitrary
 * path in the bucket.
 */
app.post<{ Body: { project?: EditProject; label?: string } }>('/api/edits/render', async (req, reply) => {
  const problem = validateEditProject(req.body?.project);
  if (problem) return reply.code(400).send({ code: 'bad-request', message: problem });
  const project = req.body!.project!;

  const firstFilm = project.clips
    .filter((c) => c.trackId === EDIT_MAIN_TRACK)
    .sort((a, b) => a.start - b.start)
    .map((c) => c.source)
    .find((src): src is Extract<EditSource, { type: 'video' }> => src?.type === 'video' && Boolean(src.jobId));
  const base = firstFilm?.jobId ? await getJob(firstFilm.jobId) : null;
  if (!base) {
    return reply.code(400).send({
      code: 'no-film',
      message: "Put at least one of this project's films on the main track — the edit is saved as a version of it.",
    });
  }

  const load = async (src: EditSource): Promise<Buffer | null> => {
    if (src.type === 'video' && src.jobId) {
      const job = await getJob(src.jobId);
      // A layered edit plays the film's clean footage; everything else plays the finished film.
      const path = src.variant === 'clean' ? job?.cleanStoragePath : job?.finalStoragePath;
      return path ? ((await readObject(path))?.bytes ?? null) : null;
    }
    if (src.storagePath && /^refs\/[\w-]+\/[^/]+$/.test(src.storagePath)) {
      return (await readObject(src.storagePath))?.bytes ?? null;
    }
    return null;
  };

  try {
    const started = Date.now();
    const { bytes, seconds } = await renderEditProject(project, load);
    const count = (kind: string) => project.clips.filter((c) => (kind === 'text' ? c.text : c.source?.type === kind)).length;
    const saved = await saveDerived(base, bytes, {
      kind: 'edit',
      label: req.body?.label?.trim().slice(0, 120) || 'Edited cut',
      note: `Edited in the video editor: ${count('video')} video, ${count('image')} still, ${count('text')} text, ${project.clips.filter((c) => c.layer).length} layer and ${count('audio')} sound clip(s) — ${seconds.toFixed(1)}s at ${project.aspect}, rendered in ${Math.round((Date.now() - started) / 1000)}s.`,
      caller: req.caller,
      resolution: base.resolution,
      editProject: project,
    });
    return { jobId: saved.jobId, finalUrl: `/api/clips/${saved.jobId}/final` };
  } catch (err) {
    app.log.error({ err: (err as Error).message }, 'edit render failed');
    return reply.code(400).send({ code: 'edit-failed', message: (err as Error).message.slice(0, 600) });
  }
});

/** A caption's, the footer's or the end card's picture, drawn exactly as an export will draw it. */
app.post<{ Body: { layer?: EditLayer; look?: EditLook; scale?: number } }>('/api/edits/layer', async (req, reply) => {
  const { layer, look } = req.body ?? {};
  const bad = validateEditLayer(layer) ?? validateEditLook(look);
  if (bad) return reply.code(400).send({ code: 'bad-request', message: bad });
  if (layer!.kind === 'logo') return reply.code(400).send({ code: 'bad-request', message: 'A logo is shown from its own image.' });
  if (layer!.kind === 'footer' && !layer!.text.trim()) return { png: '', width: 0, height: 0 };
  // The sizes the editor offers, no more: a caption at twice its size on a film's own frame.
  const scale = Number.isFinite(req.body?.scale) ? Math.max(0.5, Math.min(2, Number(req.body!.scale))) : 1;
  const png = await drawingTurn(() => drawLayer(layer as DrawnLayer, look!, scale));
  const m = await sharp(png).metadata();
  return { png: png.toString('base64'), width: m.width ?? 0, height: m.height ?? 0 };
});

/**
 * Layer pictures are drawn two at a time on an instance. The route is open to viewers, and
 * the same instance stitches paid films: a burst of drawings queues rather than crowding them out.
 */
const DRAWING_AT_ONCE = 2;
let drawing = 0;
const waitingToDraw: Array<() => void> = [];
async function drawingTurn<T>(work: () => Promise<T>): Promise<T> {
  // A drawing that finishes hands its turn straight to the next in line, so none slips in between.
  if (drawing >= DRAWING_AT_ONCE) await new Promise<void>((go) => waitingToDraw.push(go));
  else drawing++;
  try {
    return await work();
  } finally {
    const next = waitingToDraw.shift();
    if (next) next();
    else drawing--;
  }
}

/** A new logo for a layer: cleaned when it was uploaded, fitted here to the film's logo box. */
app.post<{ Body: { storagePath?: string; whitePath?: string; look?: EditLook } }>('/api/edits/logo', async (req, reply) => {
  const { storagePath, whitePath, look } = req.body ?? {};
  const ref = /^refs\/[\w-]+\/[^/]+$/;
  if (!storagePath || !ref.test(storagePath) || (whitePath !== undefined && !ref.test(whitePath))) {
    return reply.code(400).send({ code: 'bad-request', message: 'Upload the logo first.' });
  }
  const badLook = validateEditLook(look);
  if (badLook) return reply.code(400).send({ code: 'bad-request', message: badLook });
  const colour = await readObject(storagePath);
  if (!colour) return reply.code(404).send({ code: 'not-found', message: 'That logo is gone from storage. Upload it again.' });
  const white = whitePath ? await readObject(whitePath) : null;
  const fitted = await fitReplacementLogo(colour.bytes, white?.bytes ?? null, look!);
  const c = await putRef('logo-edit.png', 'image/png', fitted.colour);
  const w = fitted.white ? await putRef('logo-edit-white.png', 'image/png', fitted.white) : null;
  return { colourPath: c.storagePath, ...(w ? { whitePath: w.storagePath } : {}), w: fitted.w, h: fitted.h };
});

app.get<{ Params: { jobId: string } }>('/api/generations/:jobId', async (req, reply) => {
  if (!allows(req.caller ?? null, 'creator')) return reply.code(403).send(VIEWER_BLOCKED);
  const job = await getJob(req.params.jobId);
  if (!job) return reply.code(404).send({ code: 'not-found', message: 'No such generation' });
  return {
    jobId: job.jobId,
    createdAt: job.createdAt,
    label: job.label,
    modelName: job.modelName,
    modelId: job.modelId,
    status: job.status,
    vehicle: job.vehicle,
    vehicleChecks: job.vehicleChecks ?? [],
    joins: job.joins ?? [],
    referenceFiles: job.referenceFiles ?? [],
    prompts: job.prompts ?? [],
    brief: job.brief ?? null,
    sceneEdits: job.sceneEdits ?? null,
    projectSnapshot: job.projectSnapshot ?? null,
    feedback: job.feedback,
    parentJobId: job.parentJobId,
  };
});

/**
 * Look at a vehicle's photographs again and file each one under what it shows.
 *
 * The library was built by trusting CarDekho's filenames. They are a guess: for
 * the XUV 3XO, the file named for the front held a side profile and the one
 * named for the side held the front — so the app captioned a side shot FRONT,
 * told the model that was the front, and the front became the one view it never
 * saw. This re-files the photos already stored, without downloading anything.
 */
/**
 * Read a vehicle's colours again, without touching its photographs.
 *
 * The sync used to keep the first ten colours it found, so a model with more lost
 * the rest — Citrine Yellow on the XUV 3XO among them. A full re-sync would put
 * them back but replace the photos as well, and with them every angle filed by
 * hand. This corrects the colour list alone, and says what it added.
 */
app.post<{ Params: { id: string } }>('/api/cars/:id/colours', async (req, reply) => {
  const car = await getOne<CarModelProfile>('cars', req.params.id);
  if (!car) return reply.code(404).send({ code: 'not-found', message: 'No such vehicle' });
  if ((car.kind ?? 'car') === 'bike') {
    return reply
      .code(422)
      .send({ code: 'bike', message: 'Bike colours come with the full sync — use Re-sync for this one.' });
  }
  const colours = await syncColours(car);
  if (!colours) {
    return reply
      .code(502)
      .send({ code: 'no-page', message: 'The source page did not come back. Try again in a moment.' });
  }
  if (!colours.length) {
    return reply.code(422).send({ code: 'no-colours', message: 'The source page lists no colours for this model.' });
  }
  const before = new Set((car.colours ?? []).map((c) => c.name.toLowerCase()));
  const added = colours.filter((c) => !before.has(c.name.toLowerCase())).map((c) => c.name);
  // Round-tripped so no undefined field reaches Firestore: a colour with no image
  // or no hex carries the key with nothing in it, and a write with that fails.
  await patch('cars', car.id, { colours: JSON.parse(JSON.stringify(colours)), updatedAt: Date.now() });
  return { ok: true, count: colours.length, added };
});

app.post<{ Params: { id: string } }>('/api/cars/:id/recheck', async (req, reply) => {
  const car = await getOne<CarModelProfile>('cars', req.params.id);
  if (!car) return reply.code(404).send({ code: 'not-found', message: 'No such vehicle' });
  const checkKey = await googleKey();
  if (!checkKey) {
    return reply.code(503).send({ code: 'no-key', message: 'Checking photos needs the Google key.' });
  }

  const flat: { angle: CarAngle; img: StoredImage; bytes: Buffer }[] = [];
  for (const angle of ['front', 'side', 'rear', 'interior'] as CarAngle[]) {
    for (const img of car.images?.[angle] ?? []) {
      const obj = img.storagePath ? await readObject(img.storagePath).catch(() => null) : null;
      if (obj) flat.push({ angle, img, bytes: obj.bytes });
    }
  }
  if (!flat.length) return reply.code(400).send({ code: 'no-photos', message: 'No photos to look at.' });

  const subject = `${car.brand} ${car.model}`;
  const seen = await seePhotos(flat.map((f) => ({ bytes: f.bytes })), subject, checkKey);
  if (!seen.length) {
    return reply.code(502).send({ code: 'check-failed', message: 'The photo check did not come back.' });
  }

  const images: Partial<Record<CarAngle, StoredImage[]>> = {};
  const moved: string[] = [];
  const dropped: string[] = [];
  flat.forEach((f, i) => {
    const look = seen[i];
    if (look && !look.isVehicle) {
      dropped.push(`${f.img.filename}${look.note ? ` — ${look.note}` : ''}`);
      return;
    }
    const view = look && look.view !== 'other' && look.view !== 'detail' ? look.view : f.angle;
    if (view !== f.angle) moved.push(`${f.img.filename}: ${f.angle} → ${view}`);
    (images[view] ??= []).push({ ...f.img, angle: view, label: `${subject} — ${view}` });
  });

  const angles = Object.keys(images) as CarAngle[];
  await patch('cars', car.id, {
    images,
    syncStatus: angles.length >= 4 ? 'ok' : angles.length >= 2 ? 'partial' : 'needs-manual',
    syncNote:
      moved.length || dropped.length
        ? `Looked at the photos: ${[...moved, ...dropped.map((d) => `dropped ${d}`)].join('; ')}.`
        : 'Looked at the photos — every one was filed correctly.',
    updatedAt: Date.now(),
  });
  return { ok: true, moved, dropped, angles };
});

/**
 * File a dealership's photographs by the room they were taken in, and build one
 * sheet per room.
 *
 * The same problem the vehicle had: ten reference slots, a showroom with thirty
 * photographs, and no way for the model to know which of them is the delivery bay.
 * A sheet spends one slot on every photograph of one room, and the room each
 * photograph shows is worked out by looking at it — nobody labels an upload, and a
 * Google Business import labels nothing at all.
 *
 * Photographs already filed by hand keep their room; only the unfiled ones are
 * looked at, so a correction made in the editor is never undone here.
 */
app.post<{ Params: { id: string }; Body?: { relabel?: boolean } }>(
  '/api/clients/:id/sheets',
  async (req, reply) => {
    const client = await getOne<ClientProfile>('clients', req.params.id);
    if (!client) return reply.code(404).send({ code: 'not-found', message: 'No such client' });

    const loaded: { img: StoredImage; bytes: Buffer }[] = [];
    for (const img of client.photos ?? []) {
      const obj = img.storagePath ? await readObject(img.storagePath).catch(() => null) : null;
      if (obj) loaded.push({ img, bytes: obj.bytes });
    }
    if (!loaded.length) {
      return reply.code(400).send({ code: 'no-photos', message: 'No showroom photos to sort.' });
    }

    // Only what has not been filed by hand — unless a relabel was asked for.
    const relabel = req.body?.relabel === true;
    const toLook = loaded.filter((l) => relabel || !l.img.view);
    let looked: string[] = [];
    const lookKey = await googleKey();
    if (toLook.length && lookKey) {
      looked = await seeDealerPhotos(
        toLook.map((l) => ({ bytes: l.bytes })),
        client.displayName || client.name,
        lookKey,
      );
    }
    const guessed = new Map<string, DealerView | 'other'>();
    toLook.forEach((l, i) => {
      const v = looked[i];
      if (v) guessed.set(l.img.refId, v as DealerView | 'other');
    });

    const photos: StoredImage[] = [];
    const byView = new Map<DealerView, { bytes: Buffer; label: string }[]>();
    const counts: Record<string, number> = {};
    for (const l of loaded) {
      const view = (relabel ? undefined : l.img.view) ?? (guessed.get(l.img.refId) as DealerView | undefined);
      const filed = view && view !== ('other' as DealerView) ? view : undefined;
      photos.push(filed ? { ...l.img, view: filed } : { ...l.img, view: undefined });
      if (!filed) continue;
      counts[filed] = (counts[filed] ?? 0) + 1;
      byView.set(filed, [...(byView.get(filed) ?? []), { bytes: l.bytes, label: l.img.label }]);
    }

    const sheets: Partial<Record<DealerView, StoredImage>> = {};
    for (const { id: view, label } of DEALER_VIEWS) {
      const shots = byView.get(view) ?? [];
      if (shots.length < 2) continue;
      const bytes = await contactSheet(shots.slice(0, 9), { labels: false, max: 9, cell: 480 }).catch(() => null);
      if (!bytes) continue;
      const filename = `${client.id}-place-${view}.jpg`;
      const { refId, storagePath } = await putRef(filename, 'image/jpeg', bytes);
      sheets[view] = {
        refId,
        storagePath,
        filename,
        url: `/api/refs/${refId}/${filename}`,
        label: `${label} — ${Math.min(shots.length, 9)} photographs`,
        view,
      };
    }

    await patch('clients', client.id, { photos, sheets, updatedAt: Date.now() });
    return {
      ok: true,
      counts,
      sheets: Object.keys(sheets),
      unfiled: photos.filter((p) => !p.view).length,
      looked: toLook.length,
      note: lookKey
        ? undefined
        : 'No Google key, so nothing could be looked at — file the photos by hand and build the sheets again.',
    };
  },
);

/** Every generation ever made for a project — nothing is overwritten. */
/**
 * A run still marked "running" long after its last progress was cut off — most
 * often the server was killed mid-run (out of memory), which ends the request
 * without a word, so nothing ever marks the job failed. Progress is written
 * after every segment, and no single segment takes this long (Seedance polls
 * for 20 minutes at most), so past this it is reported as interrupted.
 */
const STALE_RUN_MS = 25 * 60 * 1000;
const interrupted = (j: JobRecord): boolean =>
  j.status === 'running' && Date.now() - (j.updatedAt ?? j.createdAt) > STALE_RUN_MS;

/**
 * Put back the generations whose first save was lost.
 *
 * From 10 Sept until the undefined-field fix, a run that was not upscaled failed its
 * first save. The merge-writes that followed left a record holding the clips and the
 * finished video but no project, no creation time and no cost, so it never appeared
 * in its project's history. Every finished run logged a "generate" activity within a
 * second of finishing, carrying its project and cost — that is the match. Only
 * records with no project are touched, and a run without exactly one clear match is
 * left alone.
 */
async function repairOrphanedJobs(): Promise<void> {
  const orphans = (await listAllJobDocs()).filter(
    (j) => !j.projectId && !j.createdAt && j.finishedAt && j.finalStoragePath,
  );
  if (!orphans.length) return;
  const activity = (await listActivity(2000)).filter((a) => a.type === 'generate' && a.projectId);
  const near = (j: JobRecord) => activity.filter((a) => Math.abs(a.at - j.finishedAt!) <= 90_000);
  for (const j of orphans) {
    const found = near(j);
    // One activity belongs to one run, and one run to one activity.
    if (found.length !== 1 || orphans.some((o) => o !== j && near(o).includes(found[0]!))) {
      app.log.warn({ jobId: j.jobId, candidates: found.length }, 'orphaned generation left alone — no single match');
      continue;
    }
    const a = found[0]!;
    const project = await getOne<Record<string, any>>('projects', a.projectId!).catch(() => null);
    const clips = j.clips ?? [];
    const [secsLabel, aspect, modelName] = (a.detail ?? '').split(' · ');
    const totalSeconds =
      Number.parseFloat(secsLabel ?? '') || Math.round(clips.reduce((t, c) => t + (c.seconds ?? 0), 0) * 10) / 10;
    const useCases: string[] = project?.useCases ?? [];
    // Rendering time is on the clips; the stitch and the uploads add about half a minute.
    const createdAt = j.finishedAt! - clips.reduce((t, c) => t + (c.renderMs ?? 0), 0) - 30_000;
    await updateJob(j.jobId, {
      jobId: j.jobId,
      projectId: a.projectId,
      projectName: a.projectName,
      userId: a.uid,
      userEmail: a.email,
      userName: a.name,
      label: `${totalSeconds}s · ${useCases.length} use case${useCases.length === 1 ? '' : 's'}`,
      modelName: modelName?.trim() || undefined,
      createdAt,
      startedAt: createdAt,
      categories: useCases,
      dealerName: '',
      aspect: aspect?.trim() || project?.spec?.aspect || '',
      resolution: project?.spec?.resolution ?? '720p',
      totalSeconds,
      costInr: a.costInr ?? 0,
      costUsd: a.costInr ? Math.round((a.costInr / DEFAULT_USD_TO_INR) * 10_000) / 10_000 : undefined,
    });
    app.log.info(
      { jobId: j.jobId, projectId: a.projectId, projectName: a.projectName },
      'orphaned generation put back in its project history',
    );
  }
}

repairOrphanedJobs().catch((e) => app.log.warn({ err: (e as Error).message }, 'generation repair failed'));

app.get<{ Params: { id: string } }>('/api/projects/:id/generations', async (req) => {
  const all = await listJobsForProject(req.params.id);
  // A hidden run is still there; only an admin is shown it, and only so it can
  // be put back.
  const admin = allows(req.caller ?? null, 'admin');
  const jobs = admin ? all : all.filter((j) => !j.hidden);
  if (!allows(req.caller ?? null, 'creator')) {
    // Only the latest cut, to watch: no cost, no model, no retake notes, no older versions.
    const latest = jobs
      .filter((j) => j.finalStoragePath && !(j.status === 'running' && !interrupted(j)))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return {
      items: latest
        ? [
            {
              jobId: latest.jobId,
              status: 'done' as const,
              createdAt: latest.createdAt,
              totalSeconds: latest.totalSeconds,
              aspect: latest.aspect,
              resolution: latest.resolution,
              segments: 0,
              kind: 'generate' as const,
              approved: false,
              hidden: false,
              canHide: false,
              restorable: false,
              finalUrl: `/api/clips/${latest.jobId}/final`,
              posterUrl: latest.posterPath ? `/api/clips/${latest.jobId}/poster` : null,
            },
          ]
        : [],
    };
  }
  return {
    items: jobs.map((j) => ({
      jobId: j.jobId,
      label: j.label,
      modelName: j.modelName,
      status: interrupted(j) ? ('failed' as const) : j.status,
      createdAt: j.createdAt,
      totalSeconds: j.totalSeconds,
      // What a run cost is for admins.
      costInr: admin ? j.costInr : undefined,
      costUsd: admin ? j.costUsd : undefined,
      usdPerSecond: admin ? j.usdPerSecond : undefined,
      aspect: j.aspect,
      resolution: j.resolution,
      segments: j.clips?.length ?? 0,
      dealerName: j.dealerName,
      categories: j.categories,
      error: interrupted(j) ? 'Interrupted — the server stopped before this video finished. Nothing more will arrive; generate again.' : j.error,
      parentJobId: j.parentJobId,
      refinedParts: j.refinedParts,
      feedback: j.feedback,
      // Older runs predate startedAt/finishedAt; their record timestamps are
      // the same span, measured from job creation to the last write.
      durationMs:
        j.status === 'running' && !interrupted(j)
          ? undefined
          : Math.max(0, (j.finishedAt ?? j.updatedAt) - (j.startedAt ?? j.createdAt)) || undefined,
      renderResolution: j.renderResolution,
      vehicle: j.vehicle,
      kind: j.kind ?? (j.parentJobId ? 'retake' : 'generate'),
      approved: j.approved === true,
      hidden: j.hidden === true,
      canHide: admin,
      derivedFrom: j.derivedFrom,
      derivedNote: j.derivedNote,
      /** Whether this run can be re-opened — older runs were saved before the receipt existed. */
      restorable: Boolean(j.projectSnapshot),
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
      : req.params.part === 'clean'
        ? job.cleanStoragePath
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
  const isVideo = (b.contentType ?? '').startsWith('video/');
  const cap = isVideo ? 45 * 1024 * 1024 : 8 * 1024 * 1024;
  if (bytes.length > cap) {
    return reply.code(413).send({
      code: 'too-large',
      message: isVideo
        ? 'Reference video exceeds 45MB — trim it, or export it smaller.'
        : 'Reference image exceeds 8MB.',
    });
  }
  /*
   * A logo is cleaned on the way in: its background removed, and a white version
   * made for dark backgrounds. Stored as it came, a logo saved with a white canvas
   * put a white box on every end card. An image that cannot be read as one is kept
   * exactly as it was sent.
   */
  if ((b.kind === 'logo' || b.kind === 'brand-logo') && !isVideo) {
    try {
      const cleaned = await cleanLogo(bytes);
      const base = (b.filename || 'logo').replace(/\.[a-z0-9]+$/i, '') || 'logo';
      const main = await putRef(`${base}.png`, 'image/png', cleaned.colour);
      const white = await putRef(`${base}-white.png`, 'image/png', cleaned.white);
      return {
        refId: main.refId,
        storagePath: main.storagePath,
        filename: `${base}.png`,
        label: b.label.trim(),
        kind: b.kind,
        cleaned: cleaned.removedBackground,
        white: {
          refId: white.refId,
          storagePath: white.storagePath,
          filename: `${base}-white.png`,
          label: `${b.label.trim()} (white)`,
        },
      };
    } catch (err) {
      app.log.warn({ err: (err as Error).message }, 'logo could not be cleaned; stored as sent');
    }
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

/**
 * Tidy a client's logos, and pull the brand's if it has none.
 *
 * Every logo already saved is cleaned — background off, a white version made — and
 * written back as transparent PNGs. The brand logo is looked up when there is none,
 * or when asked for again, and where it came from is kept on the record so a
 * designer can see it and replace it with the dealership's own file.
 */
app.post<{ Params: { id: string }; Body?: { pullBrand?: boolean; cleanOnly?: boolean } }>('/api/clients/:id/logos', async (req, reply) => {
  const client = await getOne<ClientProfile>('clients', req.params.id);
  if (!client) return reply.code(404).send({ code: 'not-found', message: 'No such client' });

  const asStored = (r: { refId: string; storagePath: string }, filename: string, label: string): StoredImage => ({
    refId: r.refId,
    storagePath: r.storagePath,
    filename,
    label,
    url: `/api/refs/${r.refId}/${safeRefName(filename)}`,
  });
  const keep = async (bytes: Buffer, base: string, label: string) => {
    const c = await cleanLogo(bytes);
    const colour = await putRef(`${base}.png`, 'image/png', c.colour);
    const white = await putRef(`${base}-white.png`, 'image/png', c.white);
    return {
      colour: asStored(colour, `${base}.png`, label),
      white: asStored(white, `${base}-white.png`, `${label} (white)`),
      removed: c.removedBackground,
    };
  };

  const fields: Partial<ClientProfile> = { logoCleanVersion: LOGO_CLEAN_VERSION };
  const notes: string[] = [];
  if (client.logo?.storagePath) {
    const obj = await readObject(client.logo.storagePath).catch(() => null);
    if (obj) {
      const k = await keep(obj.bytes, `${client.id}-dealer-logo`, client.logo.label || 'Dealership logo');
      fields.logo = k.colour;
      fields.logoWhite = k.white;
      notes.push(k.removed ? 'took the background off the dealership logo' : 'the dealership logo was already transparent');
    }
  }

  const brand = (client.brands?.find((x) => x.trim()) ?? client.brand ?? '').trim();
  let pulled = false;
  // Cleaning again only — as when a client is opened — never goes looking for a brand logo.
  if (!req.body?.cleanOnly && (req.body?.pullBrand === true || !client.brandLogo)) {
    const found = brand ? await findBrandLogo(brand).catch(() => null) : null;
    if (found) {
      const k = await keep(found.bytes, `${client.id}-brand-logo`, `${brand} logo`);
      fields.brandLogo = k.colour;
      fields.brandLogoWhite = k.white;
      fields.brandLogoSource = found.source;
      pulled = true;
      notes.push(`pulled the ${brand} logo from ${found.source}`);
    } else if (req.body?.pullBrand === true) {
      notes.push(`no ${brand || 'brand'} logo could be found — upload one`);
    }
  }
  if (!pulled && client.brandLogo?.storagePath) {
    const obj = await readObject(client.brandLogo.storagePath).catch(() => null);
    if (obj) {
      const k = await keep(obj.bytes, `${client.id}-brand-logo`, client.brandLogo.label || `${brand} logo`);
      fields.brandLogo = k.colour;
      fields.brandLogoWhite = k.white;
      notes.push(k.removed ? 'took the background off the brand logo' : 'the brand logo was already transparent');
    }
  }

  if (Object.keys(fields).length) await patch('clients', client.id, { ...fields, updatedAt: Date.now() });
  return { ok: true, notes, pulled };
});

/**
 * Draw the storyboard's frames: one still per scene, from the same photographs
 * the video will be built on.
 *
 * Batched, and the assets are read once for the lot — a film is eight scenes and
 * reading the whole reference set eight times is eight times the wait for nothing.
 * A scene that fails comes back with its reason rather than failing the batch: one
 * refusal should not cost the other seven.
 */
app.post<{
  Body: {
    brief?: Brief;
    scenes?: { key: string; shot?: string; title?: string; line?: string; ref?: string }[];
  };
}>('/api/scene-images', async (req, reply) => {
  const brief = req.body?.brief;
  const scenes = (req.body?.scenes ?? []).filter((sc) => sc?.key && String(sc.shot ?? '').trim());
  if (!brief || !scenes.length) {
    return reply.code(400).send({ code: 'bad-request', message: 'A brief and at least one scene are required.' });
  }
  const apiKey = await scriptKey();
  if (!apiKey) {
    return reply
      .code(503)
      .send({ code: 'script-no-key', message: 'Drawing scenes needs a Google Gemini key. Add one in APIs & models.' });
  }

  const { carRefs, actorRef, references } = await loadBriefAssets(brief);
  const ctx = sceneImageContext(brief);
  const onCameraPerson = narrationMode(brief.narration).onCameraPerson;

  const shot = (sc: (typeof scenes)[number]): SceneImageRef[] => {
    const out: SceneImageRef[] = [];
    const add = (r: LabelledRef | undefined): void => {
      if (!r?.ref.data || out.some((x) => x.data === r.ref.data)) return;
      out.push({ data: r.ref.data, mimeType: r.ref.mimeType, label: r.label });
    };

    const text = sc.shot ?? '';
    // The photograph this shot was going to be built on — then a couple more sides
    // of the vehicle, so the model is not guessing at the ones just out of frame.
    const visual = sceneVisual(text, sc.ref, brief.attachments ?? [], brief.vehicleKind ?? 'car');
    const wantedCar =
      visual.kind === 'picked' || visual.kind === 'matched'
        ? carRefs.find((r) => r.filename === visual.photo.filename)
        : undefined;
    const cars = [wantedCar, ...carRefs].filter(Boolean) as LabelledRef[];
    // The room this shot is set in, rather than whichever dealership photograph
    // came first — a wide exterior of the building was being drawn from a picture
    // of the showroom floor, so the film opened on somebody else's forecourt.
    const places = placeRefsFor(text, references.filter((r) => r !== actorRef));

    /*
     * Which matters more in this frame.
     *
     * A shot that names the place is a shot about the place: it leads with the
     * photographs of it and keeps one of the vehicle, so the car in the background
     * is still the right car. Everything else leads with the vehicle.
     */
    if (placeViewFor(text)) {
      places.slice(0, 3).forEach(add);
      cars.slice(0, 2).forEach(add);
    } else {
      cars.slice(0, 4).forEach(add);
      places.slice(0, 1).forEach(add);
    }
    /*
     * The presenter, whenever there is one.
     *
     * This used to be sent only when the narration puts a person on camera — and a
     * voiceover film whose shot direction still mentions a presenter got no
     * photograph of anyone, so the model drew whoever it liked. A man appeared in a
     * film cast with a woman, and then in the video, because this still is what the
     * video is built from.
     */
    add(actorRef);
    return out.slice(0, 6);
  };

  type Result = { key: string; frame?: StoredImage; error?: string };
  const results: Result[] = scenes.map((sc) => ({ key: sc.key }));
  let next = 0;
  const LANES = 3;
  await Promise.all(
    Array.from({ length: Math.min(LANES, scenes.length) }, async () => {
      for (;;) {
        const i = next++;
        const sc = scenes[i];
        if (!sc) return;
        try {
          const drawn = await drawSceneFrame(
            {
              ...ctx,
              shot: String(sc.shot),
              title: sc.title,
              onCameraPerson,
              references: shot(sc),
            },
            apiKey,
          );
          const ext = drawn.mimeType.includes('png') ? 'png' : 'jpg';
          const filename = `scene-${sc.key.replace(/[^a-zA-Z0-9]+/g, '-')}-${Date.now().toString(36)}.${ext}`;
          const { refId, storagePath } = await putRef(filename, drawn.mimeType, drawn.bytes);
          results[i] = {
            key: sc.key,
            frame: {
              refId,
              storagePath,
              filename,
              url: `/api/refs/${refId}/${filename}`,
              label: `${sc.title || 'Scene'} — how this shot is framed`,
            },
          };
        } catch (e) {
          const err = e as SceneImageError;
          results[i] = { key: sc.key, error: err.message || 'The image model did not answer.' };
        }
      }
    }),
  );

  const made = results.filter((r) => r.frame).length;
  if (!made) {
    const why = results.find((r) => r.error)?.error ?? 'Nothing came back.';
    return reply.code(502).send({ code: 'no-frames', message: why });
  }
  return { scenes: results, made };
});

app.get<{ Params: { refId: string; name: string } }>('/api/refs/:refId/:name', async (req, reply) => {
  // Links saved before this fix carry the original upload name; storage has the
  // safe one. Normalising here makes those existing thumbnails load again.
  const obj = await readObject(`refs/${req.params.refId}/${safeRefName(req.params.name)}`);
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
