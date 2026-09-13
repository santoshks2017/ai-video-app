import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import {
  brandMatches,
  isPromptOnly,
  estimateCost,
  estimateSegmentsCost,
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
  VEO_31_DEFAULTS,
  VEO_31_FAST_DEFAULTS,
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
import { checkVehicleFrame } from './vehicleCheck.js';
import {
  saveJob,
  updateJob,
  getJob,
  uploadClip,
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
import {
  composeFinal,
  contactSheet,
  joinVideos,
  keepRanges,
  lastFrame,
  posterFrame,
  selfTest,
  splitVideo,
  trimClip,
  upscaleVideo,
  videoFacts,
  type BrandOverlay,
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
  uncountRun,
  allows,
  PREVIEW_UID,
  type Caller,
} from './users.js';
import { listAll, getOne, upsert, patch, remove, type Collection } from './library.js';
import { writeScript, addPhonetics, ScriptError, type ScriptScene, type ScriptLanguage } from './script.js';
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
  sceneEditFor,
  DEFAULT_USD_TO_INR,
  clampPace,
  storyGuidance,
  storyTheme,
  themeDirection,
  plainSpoken,
} from '@ava/shared';
import { syncVehicleModel, listBrandModels, title } from './carSync.js';
import { seePhotos } from './vision.js';
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
  // Hiding a run changes what the team is told it has spent: admin only.
  if (/^\/api\/generations\/[^/]+\/hide$/.test(url)) return 'admin';
  if (url.startsWith('/api/brands') && method !== 'GET') return 'creator';
  if (url.startsWith('/api/models/seed')) return 'admin';
  if (url.startsWith('/api/models') && method !== 'GET') return 'admin';

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
          ? 'Only an admin can change API connections, models or roles.'
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

/** The Gemini key that writes scripts, whichever model renders the video. */
async function scriptKey(): Promise<string | undefined> {
  const creds = await listAll<Record<string, any>>('credentials');
  const google = creds.find((c) => c.provider === 'google-gemini' && c.enabled !== false);
  return google && google.usesEnvKey === false ? await getCredentialKey(google.id) : config.googleApiKey;
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

/**
 * Re-run the pronunciation pass alone, against the current language guide.
 * Copy that is already approved keeps its wording; only the spoken spelling is
 * rebuilt — so tuning a guide costs one cheap text call, not a rewrite.
 */
app.post<{ Body: { lines?: { index: number; line: string }[]; languageId?: string } }>(
  '/api/script/phonetics',
  async (req, reply) => {
    const lines = (req.body?.lines ?? []).filter((l) => l && String(l.line ?? '').trim());
    if (!lines.length) return reply.code(400).send({ code: 'bad-request', message: 'lines are required' });
    const apiKey = await scriptKey();
    if (!apiKey) {
      return reply
        .code(503)
        .send({ code: 'script-no-key', message: 'This needs a Google Gemini key. Add one in APIs & models.' });
    }
    try {
      const language = await resolveLanguage(req.body?.languageId);
      return { language: language.name, lines: await addPhonetics(lines, language, apiKey) };
    } catch (e) {
      const err = e as ScriptError;
      return reply.code(err.status ?? 502).send({ code: err.code ?? 'script-failed', message: err.message });
    }
  },
);

app.post<{ Body: { brief?: Brief; languageId?: string; projectId?: string } }>(
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
  const scenes: ScriptScene[] = plan.scenes
    .map((sc, index) => ({
      index,
      title: sc.beat.title,
      direction: sc.beat.dialogue ?? '',
      seconds: sc.duration,
      // Measured without the silences at a part's edges, so no line spills across a cut.
      words: Math.max(3, Math.round(speakingSeconds(plan, sc) * 2.2)),
      card: sc.beat.card,
    }))
    .filter((sc) => sc.direction);
  if (!scenes.length) return { lines: [], model: '' };

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
        const profile = await syncVehicleModel(`${b.slug}/${m.slug}`, { kind: b.kind, apiKey: config.googleApiKey });
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
      apiKey: config.googleApiKey,
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
  const car = req.carRefs ?? [];
  const room = () => Math.max(0, model.maxReferenceImages - shown.length);

  shown.push(...car.slice(0, Math.max(1, model.maxReferenceImages - shown.length - 2)));
  if (req.actorRef && room() > 0) shown.push(req.actorRef);
  if (req.placeRef && room() > 0) shown.push(req.placeRef);
  if (!car.length && req.anchorFrame && room() > 0) {
    shown.push({
      ref: { data: req.anchorFrame.toString('base64'), mimeType: 'image/jpeg', kind: 'image' },
      label: 'a frame of the vehicle from the opening part — it must keep looking like this',
      filename: 'anchor-frame.jpg',
    });
  }
  shown.push(...req.references.filter((r) => r !== req.placeRef && r !== req.actorRef).slice(0, room()));
  // Videos are counted against their own allowance, not the image budget.
  const videos = (req.videoRefs ?? []).slice(0, 3);
  shown.push(...videos);
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
        },
        model.apiKey,
      );
    } catch (err) {
      const message = (err as Error).message ?? '';
      const tooMany = /reference|image|invalid.?argument|too many|at most/i.test(message);
      if (tooMany && list.length > 1) {
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
      const side = a.angle ? `${noun}, ${a.angle}` : `${noun} — ${a.label}`;
      carRefs.push({ ref, filename: a.filename, label: side, angle: a.angle });
    } else if (a.kind === 'actor') {
      // First of the rest: the same face, hair and clothes in every part.
      actorRef = {
        ref,
        filename: a.filename,
        label: `${a.label} — the same face, hair and clothes in every shot`,
      };
    } else {
      references.push({ ref, filename: a.filename, label: `the dealership — ${a.label}` });
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
  return {
    footerText: copy.footerText,
    dealerLogo,
    brandLogo,
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
      message: `Estimated ₹${cost.inr} exceeds the ₹500 threshold — resubmit with confirmedCostInr.`,
      cost,
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
  const sentRefs: { part: number; files: string[] }[] = [];
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
    const segmentBytes: Buffer[] = [];
    let prevBytes: Buffer | null = null;
    /** A frame of the vehicle from the opening part, handed to every part after it. */
    let anchorFrame: Buffer | undefined;
    let stopped = false;

    for (let i = 0; i < parts.length; i++) {
      // A provider cannot be interrupted mid-render, so Stop is honoured between parts:
      // whatever is already made is kept and stitched.
      if (await stopRequested(jobId)) {
        stopped = true;
        break;
      }
      const part = parts[i]!;
      const isFirst = i === 0;
      const seedFrame: Buffer | undefined =
        !isFirst && prevBytes ? ((await lastFrame(prevBytes)) ?? undefined) : undefined;

      // The photos of the vehicle this part frames — the cabin shot for a cabin
      // scene, the rear for a rear scene — rather than whatever came first. The
      // sheet leads: one image holding every angle, then the angles themselves.
      const partCars: LabelledRef[] = carRefsForPart(part, scenePlan, brief, req.body?.sceneOverrides, carRefs);
      sentRefs.push({ part: part.partNum, files: partCars.map((r) => r.filename) });

      const renderStart = Date.now();
      const ask = (): Promise<{ bytes: Buffer; interactionId: string; renderResolution: Resolution }> =>
        renderSegment(resolved, {
          prompt: isFirst ? part.text : part.continuationText || part.text,
          aspect: brief.aspect,
          duration: part.duration,
          resolution: wanted,
          seedFrame,
          anchorFrame,
          carRefs: partCars,
          actorRef,
          placeRef,
          references,
          videoRefs,
        });
      let { bytes, interactionId } = await ask();

      /*
       * Look at what came back before building the rest of the film on it.
       *
       * The model is held to the vehicle by photographs, and mostly that works —
       * but "mostly" is not good enough at ₹300–1,000 a film, and a part that
       * comes back as the wrong car poisons every part seeded from it. So one
       * frame is compared against the reference photo, and a clear mismatch is
       * made again. The judgement and the retake are both on the record.
       */
      if (partCars.length && brief.carModel && resolved.provider === 'google-gemini') {
        const frame = await posterFrame(bytes, Math.min(2.5, part.duration * 0.5)).catch(() => null);
        // Checked against a single photo, never the sheet — a grid of four cars
        // is not what one frame should look like.
        const single = carRefsForPart(part, scenePlan, brief, req.body?.sceneOverrides, carRefs)[0];
        const refPhoto = single?.ref.data ? Buffer.from(single.ref.data, 'base64') : null;
        if (frame && refPhoto) {
          const verdict = await checkVehicleFrame(frame, refPhoto, brief.carModel, resolved.apiKey);
          if (verdict.checked) {
            const remade = !verdict.same && retakesLeft > 0;
            vehicleChecks.push({ part: part.partNum, same: verdict.same, why: verdict.why, remade });
            if (remade) {
              retakesLeft -= 1;
              app.log.warn({ jobId, part: part.partNum, why: verdict.why }, 'wrong vehicle on screen — making this part again');
              const second = await ask();
              bytes = second.bytes;
              interactionId = second.interactionId;
            }
          }
        }
      }

      const storagePath = await uploadClip(jobId, part.partNum, bytes, 'video/mp4');
      clips[i] = { ...clips[i]!, interactionId, storagePath, status: 'done', renderMs: Date.now() - renderStart };
      await updateJob(jobId, { clips });

      segmentBytes.push(bytes);
      prevBytes = bytes;
      // Taken a little way into the opening part, where the vehicle is established.
      if (isFirst) anchorFrame = (await posterFrame(bytes, Math.min(3, part.duration * 0.6))) ?? undefined;
      if (await stopRequested(jobId)) {
        stopped = true;
        break;
      }
    }

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
    const finalBytes = await composeFinal(segmentBytes, {
      ...buildOverlay(brief, req.body?.sceneOverrides, dealerLogo, brandLogo, bed?.bytes),
      onJoins: (n) => {
        joins = n;
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

    // Only the parts that actually rendered are billed, so a stopped run is charged
    // for what it made.
    const made = clips.filter((c) => c.status === 'done');
    const billed = stopped
      ? estimateSegmentsCost(made.reduce((a, c) => a + (c.seconds ?? 0), 0), made.length, {
          usdPerSecond: resolved.usdPerSecond,
        })
      : cost;

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
      finalStoragePath,
      posterPath,
      musicStoragePath: bed?.storagePath,
      costInr: billed.inr,
      costUsd: billed.usd,
      totalSeconds: billed.totalSeconds,
      error: stopped ? `Stopped after ${made.length} of ${parts.length} parts. What was made is kept.` : undefined,
      finishedAt: Date.now(),
    });
    if (req.caller) {
      await recordActivity(req.caller, {
        type: 'generate',
        detail: `${cost.totalSeconds}s · ${brief.aspect} · ${resolved.label}`,
        projectId: req.body?.projectId,
        projectName: req.body?.projectName,
        costInr: cost.inr,
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
          totalCostInr: (proj.totalCostInr ?? 0) + cost.inr,
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
    app.log.error({ jobId, model: resolved?.modelId, code: e.code, message: e.message }, 'generation failed');
    const failedIdx = clips.findIndex((c) => c.status === 'pending');
    if (failedIdx >= 0) clips[failedIdx] = { ...clips[failedIdx]!, status: 'failed', error: e.message };
    // Bill what actually rendered, not what was planned. A run that dies on
    // segment 2 of 3 was quoted the full duration up front; leaving that
    // estimate on the record overstates the job in history and the project's
    // spend total.
    const billed = clips.filter((c) => c.status === 'done');
    const spent = estimateSegmentsCost(
      billed.reduce((a, c) => a + (c.seconds ?? 0), 0),
      billed.length,
      { usdPerSecond: resolved.usdPerSecond },
    );
    await updateJob(jobId, {
      ...record,
      status: 'failed',
      error: e.message,
      clips,
      costInr: spent.inr,
      costUsd: spent.usd,
      totalSeconds: spent.totalSeconds,
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
      const finalBytes = await composeFinal(
        segmentBytes,
        buildOverlay(brief, req.body?.sceneOverrides, dealerLogo, brandLogo, bed?.bytes),
      );
      const finalStoragePath = await uploadClip(jobId, 0, finalBytes, 'video/mp4'); // part 0 = final

      let posterPath: string | undefined;
      const poster = await posterFrame(finalBytes).catch(() => null);
      if (poster) {
        posterPath = (await putRef(`poster-${jobId}.jpg`, 'image/jpeg', poster).catch(() => null))?.storagePath;
      }

      await updateJob(jobId, {
        ...record,
        status: 'done',
        clips,
        finalStoragePath,
        posterPath,
        musicStoragePath: bed?.storagePath,
        finishedAt: Date.now(),
      });
      if (req.caller) {
        await recordActivity(req.caller, {
          type: 'retake',
          detail: redo.length ? `segments ${redo.join(', ')} of ${parts.length}` : 'restitch only',
          projectId: req.body?.projectId ?? source.projectId,
          projectName: req.body?.projectName ?? source.projectName,
          costInr: cost.inr,
        });
      }

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
      const e = err as OmniFlashError | SeedanceError | VeoError;
      app.log.error({ jobId, model: resolved?.modelId, code: e.code, message: e.message }, 'generation failed');
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
 * off, because the sound is already right. Seedance takes 30 seconds at a time,
 * so a longer film goes through in pieces and is joined again here.
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
    // A whole second under the cap: ModelArk rounds, and 30.0 is refused.
    const CHUNK = 29;

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
    ].join('\n');

    try {
      const pieces = await splitVideo(obj.bytes, CHUNK);
      const done: Buffer[] = [];
      for (const piece of pieces) {
        const facts = await videoFacts(piece);
        // A link if the bucket will sign one; the bytes themselves if it will not.
        const path = await uploadClip(`enhance-${job.jobId}`, done.length + 1, piece, 'video/mp4');
        const url = await signedUrlFor(path, 180);
        const out = await enhanceSeedanceClip(
          {
            prompt: instruction,
            model: picked.modelId,
            resolution: seedanceRes as '480p' | '720p' | '1080p',
            duration: facts.duration,
            videoUrl: url ?? undefined,
            videoData: url ? undefined : piece.toString('base64'),
            mimeType: 'video/mp4',
          },
          picked.apiKey,
        );
        done.push(out.bytes);
      }
      const joined = await joinVideos(done);
      const seconds = (await videoFacts(joined)).duration;
      const cost = estimateSegmentsCost(seconds, pieces.length, { usdPerSecond: picked.usdPerSecond });
      const saved = await saveDerived(job, joined, {
        kind: 'enhance',
        label: `Premium pass · ${picked.label}`,
        note: `Re-rendered for finish by ${picked.label} in ${pieces.length} pass${pieces.length === 1 ? '' : 'es'}; the cut, the people, the vehicle and the sound are the approved ones.`,
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

app.get<{ Params: { jobId: string } }>('/api/generations/:jobId', async (req, reply) => {
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
app.post<{ Params: { id: string } }>('/api/cars/:id/recheck', async (req, reply) => {
  const car = await getOne<CarModelProfile>('cars', req.params.id);
  if (!car) return reply.code(404).send({ code: 'not-found', message: 'No such vehicle' });
  if (!config.googleApiKey) {
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
  const seen = await seePhotos(flat.map((f) => ({ bytes: f.bytes })), subject, config.googleApiKey);
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
  return {
    items: jobs.map((j) => ({
      jobId: j.jobId,
      label: j.label,
      modelName: j.modelName,
      status: interrupted(j) ? ('failed' as const) : j.status,
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
