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
  name: string;
  /** Brand(s) the dealer sells, e.g. "Hyundai". */
  brand: string;
  city?: string;
  address?: string;
  phone?: string;
  tier: 'Metro Premium' | 'Regional/Volume' | 'Hyperlocal';
  logo?: StoredImage;
  /** Showroom / delivery / team photos. */
  photos: StoredImage[];
  /** Default fictionalised branding for this client. */
  fictionalize: boolean;
  fakeBrandModel?: string;
  fakeDealer?: string;
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
