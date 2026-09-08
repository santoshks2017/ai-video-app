/**
 * Library entities — the persistent layers the design team builds up once and
 * reuses across projects. Mirrors the two settings layers in the original
 * workflow diagram (Universal Settings + Client Info & Docs) plus a per-project
 * layer on top.
 */

import type { Gender, CategoryId, NarrationKey, AspectRatio, Resolution, TextLang } from './types.js';

/** A stored image: bytes live in Cloud Storage, this is the handle. */
export interface StoredImage {
  refId: string;
  storagePath: string;
  /** Served back through GET /api/refs/:refId/:name */
  url?: string;
  label: string;
  filename: string;
}

export interface ActorProfile {
  id: string;
  name: string;
  gender: Gender;
  age?: string;
  /** Wardrobe / look — injected verbatim into the prompt. */
  style?: string;
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

export interface CarModelProfile {
  id: string;
  brand: string;
  model: string;
  /** cardekho slug, e.g. "hyundai/creta" */
  slug: string;
  year?: string;
  bodyType?: string;
  /** Model-level angle set — the fallback every variant inherits. */
  images: Partial<Record<CarAngle, StoredImage[]>>;
  colours: CarColour[];
  variants: CarVariant[];
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
  /** Brand(s) the dealer sells, e.g. "Hyundai". */
  brand: string;
  city?: string;
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
  durationSec: number;
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

export interface Project {
  id: string;
  name: string;
  /** Free-text steer from the designer, prepended to the generated brief. */
  prompt?: string;
  /** Tags — every project is filed under these for search. */
  clientId?: string;
  actorId?: string;
  carId?: string;
  carVariant?: string;
  carColour?: string;
  useCases: CategoryId[];
  spec: ProjectVideoSpec;
  /** Per-category dynamic field values. */
  fieldValues: Partial<Record<CategoryId, Record<string, string>>>;
  /** Storyboard edits keyed by global scene index. */
  sceneEdits: Record<string, { dialogue?: string; shot?: string }>;
  /** Extra reference images added on this project only. */
  extraRefs: StoredImage[];
  status: ProjectStatus;
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
  name: 'Gemini Omni Flash',
  modelId: 'gemini-omni-1.1-flash',
  minClipSec: 3,
  maxClipSec: 10,
  resolutions: ['720p'],
  aspects: ['9:16', '16:9'],
  supportsImageToVideo: true,
  supportsReferenceImages: true,
  maxReferenceImages: 2,
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
  notes: '30s in one call, native audio. Speech languages do not include Hindi.',
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
  notes: 'Cheapest of the three; 15s per call, 480p/720p only.',
};

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  'google-gemini': 'Google — Gemini / Veo',
  'byteplus-ark': 'BytePlus ModelArk — Dreamina Seedance',
  'openai-compatible': 'OpenAI-compatible endpoint',
  replicate: 'Replicate',
  fal: 'fal.ai',
  custom: 'Custom HTTP endpoint',
};
