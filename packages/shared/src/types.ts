/**
 * Core domain types for the AI Video App.
 *
 * The brief is the single structured input the user fills. Everything downstream
 * — storyboard, pre-flight checks, master prompt, cost estimate, the API call —
 * is derived from it. Logic ported from the legacy single-file prompt builder
 * (`legacy/dealer-video-prompt-builder.html`) and extended per PRD-ai-video-app.md.
 */

export type CategoryId =
  | 'walkaround'
  | 'feature'
  | 'ev'
  | 'testdrive'
  | 'newlaunch'
  | 'delivery'
  | 'festival'
  | 'offer'
  | 'testimonial';

/**
 * Whether a category is wired to a real video-gen API call (`automated`) or
 * stops at the master prompt for manual use in Lumina (`presenter`).
 * Per decisions.md 2026-09-06: no provider does lip-synced multilingual avatar
 * generation from a photo yet, so the 4 presenter-led categories are prompt-only.
 */
export type CategoryMode = 'automated' | 'presenter';

export type NarrationKey = 'presenter' | 'voiceover' | 'silent' | 'customer';

export type Gender = 'female' | 'male';

export type AspectRatio = '9:16' | '1:1' | '16:9';

export type TextLang = 'english' | 'mixed' | 'hindi';

/** Omni Flash is 720p-only in v1; 480p kept for forward-compat, informational only. */
export type Resolution = '480p' | '720p';

export interface CategoryField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox';
  ph?: string;
  options?: string[];
  /** id of a sibling checkbox field that must be truthy for this field to show. */
  showIf?: string;
}

export interface MandatoryField {
  id: string;
  label: string;
}

export interface BeatContext {
  dealerShort: string;
  displayDealer: string;
  displayBrandModel: string;
  cta: string;
  totalDuration: number;
  aspect: AspectRatio;
}

/** A single storyboard beat, before it is timed into a scene. */
export interface Beat {
  title: string;
  /** Primary shot / camera direction (used when a person is on camera). */
  shot: string;
  /** Alternate shot used in no-on-camera-person modes (voiceover / silent). */
  shotAlt?: string;
  dialogue?: string;
  /** Exact on-screen card headline — collected into the spelling-lock block. */
  card?: string;
  /** Smaller sub-line under `card`. */
  cardSub?: string;
  /** Stacked centred lines (end card). */
  cardLines?: string[];
  note?: string;
  /** Set by category assembly — the category label this beat came from. */
  cat?: string;
  isEndCard?: boolean;
}

export interface CategoryDef {
  id: CategoryId;
  label: string;
  mode: CategoryMode;
  hue: number;
  music: string;
  purpose: string;
  mandatory: MandatoryField[];
  avoid: string[];
  fields: CategoryField[];
  beats: (fieldValues: Record<string, string>, ctx: BeatContext) => Beat[];
}

export interface NarrationMode {
  key: NarrationKey;
  label: string;
  speaks: boolean;
  onCameraPerson: boolean;
  lipSync: boolean;
  hint: string;
}

export interface Actor {
  id?: string;
  name: string;
  gender: Gender;
  age?: string;
  style?: string;
  voice?: string;
  sourceNote?: string;
  /** Storage path or data URI of a reference thumbnail. */
  photo?: string;
}

export interface DealerPhoto {
  /** Short label describing what the image shows — required (P0.4). */
  label: string;
  /** Stable filename the master prompt cites (P0.4). */
  filename: string;
  /** data: URI or blob URL for local preview only. */
  src?: string;
  /** Server ref id once uploaded (POST /api/refs). */
  refId?: string;
  /** Cloud Storage path of the uploaded bytes; read at generate time to ground the model. */
  storagePath?: string;
  kind: 'dealer' | 'car-model' | 'logo' | 'brand-logo';
}

export interface Dealer {
  id?: string;
  dealerName: string;
  brandModel: string;
  phone?: string;
  tier: 'Metro Premium' | 'Regional/Volume' | 'Hyperlocal';
  address?: string;
  city?: string;
  fictionalize: boolean;
  fakeBrandModel?: string;
  fakeDealer?: string;
  logo?: string;
  photos: DealerPhoto[];
}

/** The structured brief — the single user input (P0.3). */
export interface Brief {
  categories: CategoryId[];
  narration: NarrationKey;
  /** Whether the video references a specific car model (triggers the scraper, P0.2). */
  modelSpecific: boolean;
  carModel?: string;
  durationSec: number;
  /** Per-generation-call cap in seconds (Omni Flash: 3–10s). */
  maxChunkSec: number;
  aspect: AspectRatio;
  resolution: Resolution;
  music: string;
  textLang: TextLang;
  captionStyle: 'Long Narrative' | 'Short Punchy' | 'Structured';
  visualStyle: string;
  cta: string;
  footer: string;
  endCardOn: boolean;
  endCard: string;
  dealer: Dealer;
  actor: Actor;
  /** Per-category dynamic field values, keyed by category id. */
  fieldValues: Partial<Record<CategoryId, Record<string, string>>>;
  /** Labelled reference images in scope for this brief (P0.4). */
  attachments: DealerPhoto[];
  /**
   * Extra prompt direction: enabled global instructions, then the project's own
   * free-text steer. Rendered as its own block in the master prompt.
   */
  extraDirection?: string[];
}

export interface Scene {
  beat: Beat;
  part: number;
  start: number;
  end: number;
  duration: number;
  partStart: number;
}

export interface ScenePlan {
  parts: number;
  partDuration: number;
  scenes: Scene[];
  /** Beats left out so the surviving scenes have room to breathe. */
  droppedBeats: number;
}

export interface PromptPart {
  partNum: number;
  totalParts: number;
  start: number;
  end: number;
  duration: number;
  isFirst: boolean;
  isLast: boolean;
  /** Full standalone master prompt — used for part 1 (or single-part videos). */
  text: string;
  /** Compact "continue by N seconds" instruction — used for parts 2+ on the extend call. */
  continuationText: string;
}

export type CheckLevel = 'ok' | 'warn' | 'bad';

export interface Check {
  level: CheckLevel;
  text: string;
  /** Machine-readable reason, for metrics on pre-flight block rate. */
  code: string;
}

export interface CostEstimate {
  clipCount: number;
  totalSeconds: number;
  usdPerSecond: number;
  usd: number;
  inr: number;
  usdToInr: number;
  /** True when `inr` exceeds the confirmation threshold (Rs 500, P0.9). */
  needsConfirmation: boolean;
  /** True when the call count is unusually high for the duration. */
  highCallCountWarning: boolean;
}
