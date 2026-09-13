/**
 * Library entities — the persistent layers the design team builds up once and
 * reuses across projects. Mirrors the two settings layers in the original
 * workflow diagram (Universal Settings + Client Info & Docs) plus a per-project
 * layer on top.
 */

import type { Beat, Gender, CategoryId, NarrationKey, AspectRatio, Resolution, TextLang } from './types.js';

/** A stored image: bytes live in Cloud Storage, this is the handle. */
export interface StoredImage {
  refId: string;
  storagePath: string;
  /** Served back through GET /api/refs/:refId/:name */
  url?: string;
  label: string;
  filename: string;
  /**
   * For a vehicle photo attached by hand, which side of the vehicle it shows.
   * A scene about the cabin is matched to the cabin photo, and a part of the film
   * is sent the photo of what it frames — see visuals.ts.
   */
  angle?: CarAngle;
}

/** Coarse age bands, so a library of actors can be narrowed to the right one. */
export const AGE_BANDS = ['18–25', '26–35', '36–45', '46+'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export interface ActorProfile {
  id: string;
  name: string;
  gender: Gender;
  age?: string;
  /** Which band the age falls in, for filtering. Read from `age` when unset. */
  ageBand?: AgeBand;
  /** Wardrobe / look — injected verbatim into the prompt. */
  style?: string;
  /** What they are dressed in, in one or two words: saree, kurta, formal shirt. */
  attire?: string;
  /** Delivery notes — pace, warmth, energy. */
  voice?: string;
  /** Where the high-res original lives, for the designer. */
  sourceNote?: string;
  photo?: StoredImage;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/* ---------- Cars: Brand → Model → Variant → Colour ---------- */

export type CarAngle = 'front' | 'side' | 'rear' | 'interior';

/** The views a vehicle's photographs are gathered into, sheet by sheet. */
export type CarView = CarAngle | 'features';
export const CAR_VIEWS: CarView[] = ['front', 'side', 'rear', 'interior', 'features'];

/**
 * Where a vehicle's images and specs come from. CarDekho is quick and uniform;
 * the manufacturer's own site is what a dealer can show a client who asks where
 * the pictures came from. Either can be re-synced at any time.
 */
export type VehicleDataSource = 'cardekho' | 'oem' | 'google';

export interface CarColour {
  name: string;
  /** Hex sampled from the source filename when CarDekho encodes it. */
  hex?: string;
  image?: StoredImage;
}

export interface CarVariant {
  name: string;
  fuel?: string;
  transmission?: string;
  price?: string;
  /** Variant-specific shots when the source has them; otherwise inherits the model set. */
  images: Partial<Record<CarAngle, StoredImage[]>>;
  colours: CarColour[];
}

/**
 * What the car actually is, in the terms an ad uses. Scraped from the model and
 * /specs pages so a script can say "six airbags" or "one nine three millimetre
 * ground clearance" instead of reaching for adjectives.
 */
export interface CarSpecs {
  /** e.g. "5.75 - 10.77 Lakh" */
  priceRange?: string;
  /** Ex-showroom starting price in rupees, as published. */
  basePrice?: string;
  engine?: string;
  power?: string;
  torque?: string;
  transmission?: string;
  /** Bikes: top speed, kerb weight, seat height — the numbers a rider asks about. */
  topSpeed?: string;
  kerbWeight?: string;
  seatHeight?: string;
  fuelTypes?: string[];
  mileage?: string;
  bootSpace?: string;
  groundClearance?: string;
  fuelTank?: string;
  airbags?: string;
  seating?: string;
  drivetrain?: string;
  dimensions?: string;
  /** e.g. "4.7 from 163 reviews" */
  rating?: string;
}

/** Cars come from cardekho.com, bikes and scooters from bikedekho.com. */
export type VehicleKind = 'car' | 'bike';

export interface BrandEntry {
  /** Display name, and what the CarDekho brand page is keyed on. */
  name: string;
  kind: VehicleKind;
  /**
   * The slug that appears in model paths and in the source's own brandSlug
   * field — "maruti", not "maruti-suzuki". They are not always the same as the
   * display name, which is why both are stored.
   */
  slug: string;
  /**
   * Extra source listings to merge. Maruti sells through Arena and Nexa and
   * CarDekho splits them, so the main page alone misses Grand Vitara, Jimny,
   * XL6, Invicto and Ciaz.
   */
  alsoPages?: string[];
}

/** The brands the team actually sells for. Editable in the app later if needed. */
export const BRAND_CATALOGUE: BrandEntry[] = [
  { name: 'Maruti Suzuki', kind: 'car', slug: 'maruti', alsoPages: ['Nexa'] },
  { name: 'Hyundai', kind: 'car', slug: 'hyundai' },
  { name: 'Tata', kind: 'car', slug: 'tata' },
  { name: 'Mahindra', kind: 'car', slug: 'mahindra' },
  { name: 'Hero', kind: 'bike', slug: 'hero' },
  { name: 'Honda', kind: 'bike', slug: 'honda' },
  { name: 'Bajaj', kind: 'bike', slug: 'bajaj' },
  { name: 'TVS', kind: 'bike', slug: 'tvs' },
  { name: 'Royal Enfield', kind: 'bike', slug: 'royal-enfield' },
];

export interface CarModelProfile {
  id: string;
  /** Cars and bikes share this shape; only the source and the specs differ. */
  kind?: VehicleKind;
  brand: string;
  model: string;
  /** Source-site slug, e.g. "hyundai/creta" or "royal-enfield/classic-350". */
  slug: string;
  year?: string;
  bodyType?: string;
  /** Model-level angle set — the fallback every variant inherits. */
  images: Partial<Record<CarAngle, StoredImage[]>>;
  /**
   * One sheet per view: every photograph of the front in a single image, every
   * photograph of the side in another, and so on.
   *
   * A video model is given a handful of reference slots. Spending them on one
   * photo each meant three-quarters of what the source publishes never reached
   * it — and a view it has not seen is a view it invents. A sheet spends one
   * slot and carries every shot of that side.
   */
  sheets?: Partial<Record<CarView, StoredImage>>;
  /** What the source says is good and bad about it, for the copywriter. */
  pros?: string[];
  cons?: string[];
  colours: CarColour[];
  variants: CarVariant[];
  /** Headline numbers, for the copywriter. */
  specs?: CarSpecs;
  /**
   * Plain-sentence facts straight from the source ("Tata Punch comes with 6
   * airbags"), safe to quote because nothing was inferred.
   */
  highlights?: string[];
  /** Which site this record was last synced from. Records made before the choice existed are CarDekho. */
  source?: VehicleDataSource;
  /** The manufacturer's page for this model, kept even while CarDekho is the live source. */
  oemUrl?: string;
  sourceUrl?: string;
  syncedAt?: number;
  syncStatus: 'ok' | 'partial' | 'needs-manual' | 'never';
  syncNote?: string;
  createdAt: number;
  updatedAt: number;
}

/* ---------- Clients (dealers) ---------- */

export interface ClientProfile {
  id: string;
  /** Full/legal name, e.g. as it appears on the Google listing. */
  name: string;
  /**
   * Short trading name used on screen — footer, end card, spoken lines.
   * A Google Business import returns things like "Tata Motors Cars Showroom -
   * Jasper Cars Private Limited, Malviya Nagar", which no overlay can carry.
   */
  displayName?: string;
  /** The dealer's main brand, e.g. "Hyundai" — the first of `brands`. */
  brand: string;
  /**
   * Every brand this dealer sells, named as the vehicle library names them. A
   * multi-brand group picks more than one; the first is the one the films lead with.
   */
  brands?: string[];
  /**
   * Does this dealer sell cars or two-wheelers?
   *
   * Honda, Suzuki and Hero all put their badge on both, so brand alone is not
   * enough: a car dealership asked for a generic film and got motorcycles in it.
   * Defaults to cars, which is what most of these dealerships are.
   */
  vehicleKind?: VehicleKind;
  city?: string;
  /** State, for filtering a long client list down to a region. */
  state?: string;
  address?: string;
  phone?: string;
  tier: 'Metro Premium' | 'Regional/Volume' | 'Hyperlocal';
  /** Dealership logo — overlaid top-right. Transparent PNG works best. */
  logo?: StoredImage;
  /** Manufacturer logo — overlaid top-left. Transparent PNG works best. */
  brandLogo?: StoredImage;
  /** Showroom / delivery / team photos. */
  photos: StoredImage[];
  /** Default fictionalised branding for this client. */
  fictionalize: boolean;
  fakeBrandModel?: string;
  fakeDealer?: string;
  /**
   * The contact strip burned across the bottom of every video for this client.
   * Saved here rather than per project so it stays consistent — and it is
   * composited in post, so it is always legible.
   */
  footerText?: string;
  /** Google Business Profile import. */
  gmbUrl?: string;
  gmbPlaceId?: string;
  gmbSyncedAt?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/* ---------- Global instructions ---------- */

export interface GlobalInstruction {
  id: string;
  title: string;
  /** Free text appended to every master prompt while enabled. */
  body: string;
  enabled: boolean;
  /** Lower sorts first. */
  order: number;
  /** Built-ins (the pronunciation rulebook) can't be deleted, only disabled. */
  builtIn?: boolean;
  createdAt: number;
  updatedAt: number;
}

/* ---------- Projects ---------- */

export interface ProjectVideoSpec {
  /** Which VideoModelProfile generates this video. Blank = the default model. */
  modelId?: string;
  /** Which LanguageProfile the video is spoken and written in. Blank = the default. */
  languageId?: string;
  /** The film's length at 1x pace, when it is set by hand. */
  durationSec: number;
  /**
   * The app sizes the film to its use cases and what was filled in, and the
   * storyboard can take that over. Projects made before this keep their own
   * number until someone switches them to auto.
   */
  durationAuto?: boolean;
  /** Delivery speed: 1 is a natural read; 1.1 is the same words 10% faster, in a shorter film. */
  pace?: number;
  maxChunkSec: number;
  aspect: AspectRatio;
  resolution: Resolution;
  narration: NarrationKey;
  textLang: TextLang;
  captionStyle: 'Long Narrative' | 'Short Punchy' | 'Structured';
  music: string;
  visualStyle: string;
  cta: string;
  footer: string;
  endCardOn: boolean;
  endCard: string;
}

export type ProjectStatus = 'draft' | 'ready' | 'generating' | 'generated' | 'failed';

/**
 * Where a project sits on the team's board.
 *
 * `status` says what the machine has done; this says what the team still owes.
 * A film can be generated and still be in review, or delivered months after its
 * last render — so the two never collapse into one field.
 */
export type ProjectStage = 'open' | 'wip' | 'review' | 'delivered';

export interface Project {
  id: string;
  name: string;
  /** Free-text steer from the designer, prepended to the generated brief. */
  prompt?: string;
  /** Tags — every project is filed under these for search. */
  clientId?: string;
  actorId?: string;
  /** The hero vehicle. Kept for projects created before multi-select. */
  carId?: string;
  /**
   * Every vehicle the film features. A dealer promoting two models in one video
   * needs both; the first is the hero and carries the variant and colour.
   */
  carIds?: string[];
  carVariant?: string;
  carColour?: string;
  useCases: CategoryId[];
  spec: ProjectVideoSpec;
  /** Per-category dynamic field values. */
  fieldValues: Partial<Record<CategoryId, Record<string, string>>>;
  /**
   * Storyboard edits, keyed by each scene's beat key ("feature:feature-2"). Projects
   * edited before scenes had keys used the scene's position; the editor re-files
   * those. `deleted` takes the scene out of the film.
   */
  sceneEdits: Record<
    string,
    {
      dialogue?: string;
      phonetic?: string;
      shot?: string;
      ref?: string;
      card?: string;
      cardSub?: string;
      deleted?: boolean;
    }
  >;
  /** The order the designer put the storyboard in, by scene key. */
  sceneOrder?: string[];
  /** Scenes written by hand in the storyboard. */
  addedScenes?: Beat[];
  /**
   * The creative platform the last script was written to. Kept so the designer
   * can see what the copy is arguing before judging the lines themselves.
   */
  scriptAngle?: { viewer: string; idea: string; throughline: string; proof: string[] };
  /**
   * Photos of the exact vehicle this film shows, attached to the project.
   *
   * They replace the library's photo set for this project: a library holding the wrong
   * generation of a model is how an XUV300 ended up in a film about the XUV 3XO, and the
   * fix has to be in the hands of whoever is making the film.
   */
  carRefs?: StoredImage[];
  /** Extra reference images added on this project only. */
  extraRefs: StoredImage[];
  /**
   * Reference videos for this project — the real showroom, the real car moving.
   * A model that takes video references learns motion and light from these in a
   * way no still can teach it; models that do not simply never see them.
   */
  videoRefs?: StoredImage[];
  status: ProjectStatus;
  /** The board column this project sits in. Unset means it has never been moved. */
  stage?: ProjectStage;
  /** Most recent generation job. */
  lastJobId?: string;
  lastFinalUrl?: string;
  /** Running totals across every generation ever run for this project. */
  generationCount?: number;
  totalCostInr?: number;
  createdAt: number;
  updatedAt: number;
}

/** Denormalised fields the project list shows/filters on without extra reads. */
export interface ProjectSummary {
  id: string;
  name: string;
  clientId?: string;
  clientName?: string;
  actorId?: string;
  actorName?: string;
  carId?: string;
  carName?: string;
  useCases: CategoryId[];
  status: ProjectStatus;
  stage?: ProjectStage;
  lastFinalUrl?: string;
  updatedAt: number;
}

/* ---------- API providers & models ---------- */

export type ProviderKind =
  | 'google-gemini'
  | 'byteplus-ark'
  | 'openai-compatible'
  | 'replicate'
  | 'fal'
  | 'custom';

/**
 * What a signed-in person may do.
 *
 * `viewer` is the default for anyone who signs in: they can read the libraries
 * and watch finished videos, but cannot spend money or touch credentials.
 * `creator` adds the paid actions — generating, retaking, writing scripts — and
 * editing the libraries those draw on. `admin` adds API credentials, models and
 * the roles themselves.
 */
export type Role = 'viewer' | 'creator' | 'admin';

export const ROLE_ORDER: Record<Role, number> = { viewer: 0, creator: 1, admin: 2 };

export const ROLE_LABELS: Record<Role, string> = {
  viewer: 'Viewer — can look, cannot spend',
  creator: 'Creator — can generate videos and edit the libraries',
  admin: 'Admin — everything, including API keys and roles',
};

/** True when `role` is at least `needed`. */
export const roleAllows = (role: Role | undefined, needed: Role): boolean =>
  ROLE_ORDER[role ?? 'viewer'] >= ROLE_ORDER[needed];

export interface AppUser {
  /** Firebase UID. */
  id: string;
  email: string;
  name?: string;
  photo?: string;
  role: Role;
  /** Set on the account that bootstrapped the app; it can never be demoted. */
  isOwner?: boolean;
  /** Running totals, kept on the record so the admin view never scans the log. */
  generations?: number;
  spendInr?: number;
  lastSeenAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface GlossaryEntry {
  /** The word or phrase as it appears in a script, in either script system. */
  term: string;
  /** Its locked spoken form — identical in every video, every time. */
  say: string;
  /**
   * How this term is handled. `english` means leave it in ordinary English
   * spelling because the model already says it correctly — respelling it is what
   * made "test drive" come out as TEST DRAAIV. `respell` is for the words a
   * model genuinely gets wrong: prices, and Hindi words with a stress or vowel
   * trap. Default is `respell`.
   */
  mode?: 'respell' | 'english';
  note?: string;
  /** Free-text grouping for the table, e.g. "Money", "EV". */
  group?: string;
}

/**
 * Everything the pipeline needs to know about one language: how it must be
 * SPOKEN (the pronunciation rulebook fed to the script pass) and how it must be
 * WRITTEN on screen (fed to the video prompt), plus a glossary of locked
 * spellings. Editing a guide here changes every future video in that language —
 * the rules are data, not code.
 */
export interface LanguageProfile {
  id: string;
  /** Language code, matched against a model's declared speech languages. */
  code: string;
  name: string;
  nativeName?: string;
  /** Only enabled languages are offered on a project. */
  enabled: boolean;
  isDefault?: boolean;
  /**
   * Whether a line in this language has to be respelled for pronunciation before
   * it reaches the video model. Hindi does; English does not.
   */
  needsPhonetics: boolean;
  /** The pronunciation / delivery rulebook. Injected into the script pass. */
  spokenGuide: string;
  /** On-screen text rules for cards, footer and end card. Injected into the prompt. */
  writtenGuide: string;
  /** Locked spellings, checked before deriving a new one — consistency beats rules. */
  glossary: GlossaryEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface ApiCredential {
  id: string;
  /** Display name, e.g. "Gemini (CarDekho)". */
  name: string;
  provider: ProviderKind;
  /** Base URL for openai-compatible / custom providers. */
  baseUrl?: string;
  /**
   * The key itself is NEVER stored here or sent to the browser — it lives in
   * Secret Manager (or, as a fallback, a backend-only Firestore doc). This flag
   * just tells the UI whether one has been saved.
   */
  hasKey: boolean;
  /** Secret Manager secret name holding the key. */
  secretName?: string;
  /** Set when this credential reads the deploy-time GOOGLE_API_KEY env var. */
  usesEnvKey?: boolean;
  enabled: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** What a model can do — drives chunking, the specs UI and cost. */
export interface VideoModelProfile {
  id: string;
  credentialId: string;
  /** Display name, e.g. "Gemini Omni Flash". */
  name: string;
  /** The provider's model identifier, e.g. "gemini-omni-1.1-flash". */
  modelId: string;
  minClipSec: number;
  maxClipSec: number;
  resolutions: Resolution[];
  aspects: AspectRatio[];
  /** Can a still image seed the first frame? (drives multi-segment continuity) */
  supportsImageToVideo: boolean;
  supportsReferenceImages: boolean;
  /** Hard cap the provider enforces on reference images per call. */
  maxReferenceImages: number;
  usdPerSecond: number;
  /**
   * Price at a specific resolution, where the provider charges differently —
   * Veo 3.1 Fast is $0.10/s at 720p and $0.12/s at 1080p. Falls back to
   * `usdPerSecond`.
   */
  usdPerSecondByResolution?: Partial<Record<Resolution, number>>;
  /**
   * Languages the provider says the model can SPEAK, as ISO codes. Left unset
   * when the provider publishes no list — pre-flight only warns on a stated
   * restriction, never on silence.
   */
  speechLanguages?: string[];
  enabled: boolean;
  isDefault: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** The built-in model, seeded on first run so the app works out of the box. */
export const OMNI_FLASH_DEFAULTS: Omit<VideoModelProfile, 'id' | 'credentialId' | 'createdAt' | 'updatedAt'> = {
  name: 'Gemini Omni 1.1 Flash',
  modelId: 'gemini-omni-1.1-flash',
  minClipSec: 3,
  maxClipSec: 10,
  resolutions: ['360p', '720p', '1080p'],
  aspects: ['9:16', '16:9'],
  supportsImageToVideo: true,
  supportsReferenceImages: true,
  /**
   * Ten, which is what Omni 1.1 Flash accepts. The vehicle, the showroom and the
   * presenter all reach every part, alongside the frame it continues from — and
   * if a provider ever refuses the set, it is asked again with one fewer rather
   * than failing the run.
   */
  maxReferenceImages: 10,
  usdPerSecond: 0.1,
  enabled: true,
  isDefault: true,
};

/**
 * Dreamina Seedance, on BytePlus ModelArk.
 *
 * The headline difference from Omni Flash is clip length: 2.5 generates up to
 * 30 seconds in a single pass with native audio, so most dealer videos come out
 * of one call with no stitching and no cross-segment drift at all. Prices are
 * BytePlus list at 720p and are editable per model — check them before a big run.
 * Docs: https://docs.byteplus.com/en/docs/ModelArk/2607688
 */
export const SEEDANCE_25_DEFAULTS: Omit<
  VideoModelProfile,
  'id' | 'credentialId' | 'createdAt' | 'updatedAt'
> = {
  name: 'Dreamina Seedance 2.5',
  modelId: 'dreamina-seedance-2-5-260628',
  minClipSec: 4,
  maxClipSec: 30,
  resolutions: ['720p'],
  aspects: ['9:16', '1:1', '16:9'],
  supportsImageToVideo: true,
  supportsReferenceImages: true,
  // 30 images per request; we never send anywhere near that.
  maxReferenceImages: 8,
  usdPerSecond: 0.2312,
  // BytePlus publishes 11 speech languages for Seedance; Hindi is not one.
  speechLanguages: ['zh', 'en', 'es', 'id', 'ms', 'th', 'ar', 'pt', 'vi', 'ja', 'ko'],
  enabled: true,
  isDefault: false,
  notes: '30s in one call, native audio. Renders 480p/720p natively; a 1080p video is upscaled in post. Speech languages do not include Hindi.',
};

export const SEEDANCE_20_FAST_DEFAULTS: Omit<
  VideoModelProfile,
  'id' | 'credentialId' | 'createdAt' | 'updatedAt'
> = {
  name: 'Dreamina Seedance 2.0 fast',
  modelId: 'dreamina-seedance-2-0-fast-260128',
  minClipSec: 4,
  maxClipSec: 15,
  resolutions: ['720p'],
  aspects: ['9:16', '1:1', '16:9'],
  supportsImageToVideo: true,
  supportsReferenceImages: true,
  maxReferenceImages: 6,
  usdPerSecond: 0.09,
  // BytePlus publishes 11 speech languages for Seedance; Hindi is not one.
  speechLanguages: ['zh', 'en', 'es', 'id', 'ms', 'th', 'ar', 'pt', 'vi', 'ja', 'ko'],
  enabled: true,
  isDefault: false,
  notes: '15s per call. Renders 480p/720p natively; a 1080p video is upscaled in post.',
};

/**
 * Google Veo 3.1, on the same Gemini API key as Omni.
 *
 * Clips are 4, 6 or 8 seconds and nothing in between; 1080p and reference
 * images both force 8. The server renders the allowed length that fits and
 * trims to the planned segment, so the extra seconds are billed but never seen.
 * Prices are Google list (Sept 2026), editable per model.
 * Docs: https://ai.google.dev/gemini-api/docs/veo
 */
export const VEO_31_DEFAULTS: Omit<VideoModelProfile, 'id' | 'credentialId' | 'createdAt' | 'updatedAt'> = {
  name: 'Google Veo 3.1',
  modelId: 'veo-3.1-generate-preview',
  minClipSec: 4,
  maxClipSec: 8,
  resolutions: ['720p', '1080p'],
  aspects: ['9:16', '16:9'],
  supportsImageToVideo: true,
  supportsReferenceImages: true,
  maxReferenceImages: 3,
  usdPerSecond: 0.4,
  usdPerSecondByResolution: { '720p': 0.4, '1080p': 0.4 },
  enabled: true,
  isDefault: false,
  notes: '8s max per clip, native audio. 1080p and reference images always render 8s, trimmed to fit.',
};

export const VEO_31_FAST_DEFAULTS: Omit<VideoModelProfile, 'id' | 'credentialId' | 'createdAt' | 'updatedAt'> = {
  name: 'Google Veo 3.1 Fast',
  modelId: 'veo-3.1-fast-generate-preview',
  minClipSec: 4,
  maxClipSec: 8,
  resolutions: ['720p', '1080p'],
  aspects: ['9:16', '16:9'],
  supportsImageToVideo: true,
  supportsReferenceImages: true,
  maxReferenceImages: 3,
  usdPerSecond: 0.1,
  usdPerSecondByResolution: { '720p': 0.1, '1080p': 0.12 },
  enabled: true,
  isDefault: false,
  notes: 'Cheaper Veo. 8s max per clip, native audio. 1080p and reference images always render 8s, trimmed to fit.',
};

/* ---- what each model can actually render ---- */

const RES_ORDER: Resolution[] = ['360p', '480p', '720p', '1080p'];

/**
 * Resolutions each provider renders natively, by model id. Kept in code rather
 * than read from the saved model record: those records were seeded when every
 * model was listed as 720p-only, and a stale record must not decide whether a
 * video is rendered at 1080p or upscaled to it.
 */
const NATIVE_RESOLUTIONS: { match: RegExp; native: Resolution[] }[] = [
  // Omni renders 360p through 4K natively; the app delivers up to 1080p.
  { match: /^gemini-omni/, native: ['360p', '720p', '1080p'] },
  { match: /^veo-3\.1-lite/, native: ['720p', '1080p'] },
  { match: /^veo-/, native: ['720p', '1080p'] },
  // Seedance 2.0 (standard) lists 1080p; 2.0 fast and 2.5 publish 480p/720p only.
  { match: /^dreamina-seedance-2-0-(?!fast)/, native: ['480p', '720p', '1080p'] },
  { match: /^dreamina-seedance/, native: ['480p', '720p'] },
];

export function nativeResolutions(modelId: string, fallback: Resolution[] = ['720p']): Resolution[] {
  return NATIVE_RESOLUTIONS.find((r) => r.match.test(modelId))?.native ?? fallback;
}

/**
 * How to produce the resolution a project asked for on a given model: render
 * natively when the model can, otherwise render at its largest native size and
 * upscale in post. `upscale` is what the designer should be told.
 */
export function renderResolution(
  modelId: string,
  wanted: Resolution,
  fallback?: Resolution[],
): { render: Resolution; upscale: boolean } {
  const native = nativeResolutions(modelId, fallback);
  if (native.includes(wanted)) return { render: wanted, upscale: false };
  const rank = (r: Resolution): number => RES_ORDER.indexOf(r);
  // The model's nearest size to what was asked for, and on a tie the larger of
  // the two: rendering 360p to deliver 480p when 720p costs the same and looks
  // better is a downgrade nobody asked for. Anything rendered below the request
  // is upscaled in post, which is what the designer is told.
  const render =
    [...native].sort(
      (a, b) => Math.abs(rank(a) - rank(wanted)) - Math.abs(rank(b) - rank(wanted)) || rank(b) - rank(a),
    )[0] ?? '720p';
  return { render, upscale: rank(wanted) > rank(render) };
}

/** Dollars per second for a run at the resolution the model will actually render. */
export function priceFor(
  model: Pick<VideoModelProfile, 'modelId' | 'usdPerSecond' | 'usdPerSecondByResolution' | 'resolutions'>,
  wanted: Resolution,
): number {
  const { render } = renderResolution(model.modelId, wanted, model.resolutions);
  return model.usdPerSecondByResolution?.[render] ?? model.usdPerSecond;
}

/** The short side, in pixels, of a delivered resolution. */
export const shortSideFor = (r: Resolution): number =>
  r === '1080p' ? 1080 : r === '480p' ? 480 : r === '360p' ? 360 : 720;

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  'google-gemini': 'Google — Gemini / Veo',
  'byteplus-ark': 'BytePlus ModelArk — Dreamina Seedance',
  'openai-compatible': 'OpenAI-compatible endpoint',
  replicate: 'Replicate',
  fal: 'fal.ai',
  custom: 'Custom HTTP endpoint',
};
