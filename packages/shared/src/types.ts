import type { OverlayTheme } from './overlayLook.js';
/**
 * Core domain types for the AI Video App.
 *
 * The brief is the single structured input the user fills. Everything downstream
 * — storyboard, pre-flight checks, master prompt, cost estimate, the API call —
 * is derived from it. Logic ported from the legacy single-file prompt builder
 * (`legacy/dealer-video-prompt-builder.html`) and extended per PRD-ai-video-app.md.
 */

/** Who the film is for: a dealership selling down the road, or the manufacturer itself. */
export type ClientKind = 'dealer' | 'oem';

/** Where a manufacturer sits. It sets the tone of the copy, never the format. */
export type OemSegment = 'mass' | 'premium' | 'luxury';

export type CategoryId =
  | 'walkaround'
  | 'feature'
  | 'ev'
  | 'testdrive'
  | 'newlaunch'
  | 'delivery'
  | 'festival'
  | 'offer'
  | 'testimonial'
  // A manufacturer's own formats. A dealership never sees these, and an OEM never
  // sees the showroom ones — the list follows the client.
  | 'oemlaunch'
  | 'oemproduct'
  | 'oemdesign'
  | 'oemtech'
  | 'oemev'
  | 'oemsafety'
  | 'oemowner'
  | 'oembrand'
  | 'oemoffer'
  | 'oemservice';

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

/**
 * The deliverable's resolution. Not every model renders every size natively —
 * Seedance tops out at 720p — so the server renders at the model's best native
 * size and upscales in post (see renderResolution in library.ts).
 */
export type Resolution = '360p' | '480p' | '720p' | '1080p';

export interface CategoryField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'list';
  ph?: string;
  options?: string[];
  /** id of a sibling checkbox field that must be truthy for this field to show. */
  showIf?: string;
  /**
   * A repeatable row, for type 'list'. Rows are stored as numbered keys — `${id}1`,
   * `${id}2`… — so the fixed numbered fields that came before (feature1, feature2)
   * read straight into it with nothing to migrate.
   */
  list?: {
    /** What one row is called: "feature", "offer". */
    noun: string;
    /** An optional second input per row, stored as `${sub.id}N`. */
    sub?: { id: string; label: string; ph?: string };
    /** Rows shown before anything is typed. */
    min: number;
    max: number;
  };
}

export interface MandatoryField {
  id: string;
  label: string;
  /** For a repeatable field: satisfied by any row of this list id having text. */
  list?: string;
}

export interface BeatContext {
  /** The client as a film says it: the dealership's short name, or the marque. */
  dealerShort: string;
  /** The marque a manufacturer's film signs off with. Same as `dealerShort` for a dealership. */
  brandName: string;
  /** The brand line under the marque, where there is one. */
  tagline?: string;
  clientKind: ClientKind;
  displayDealer: string;
  displayBrandModel: string;
  cta: string;
  totalDuration: number;
  aspect: AspectRatio;
  vehicle: 'car' | 'bike';
  /** "test drive" or "test ride". */
  trial: string;
}

/** A single storyboard beat, before it is timed into a scene. */
export interface Beat {
  /** Stable identity within its use case, when the title can change (drive or ride, Feature 3). */
  id?: string;
  /**
   * The scene's identity in its film: the use case, then the beat's id or its place
   * among that use case's beats. Storyboard edits and deletions are filed under it,
   * so they stay on the scene they were made on while scenes around it come and go.
   */
  key?: string;
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
  /**
   * The beat's place in one ad's arc. Several use cases share one opening and one close,
   * and their points run as one story in between — see buildBeats.
   */
  role?: 'open' | 'setup' | 'point' | 'proof' | 'close';
  /** Set by category assembly — the category label this beat came from. */
  cat?: string;
  /** Written by hand in the storyboard rather than produced by a use case. */
  added?: boolean;
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
  /**
   * A theme is the setting and the tone, not a topic. Picked with other use cases it adds
   * no scenes of its own: its look is in every shot, its greeting opens the film and its
   * wish closes it.
   */
  layer?: 'theme';
  /**
   * Whose list this use case appears in. Unset is a dealership's, which is every use
   * case that existed before manufacturers did; 'both' is for the ones that serve
   * either, like a festival.
   */
  audience?: ClientKind | 'both';
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
  kind: 'dealer' | 'car-model' | 'logo' | 'brand-logo' | 'actor' | 'reference-video' | 'extra';
  /** For a car photo, the part of the car it shows — what a scene about that part is matched to. */
  angle?: 'front' | 'side' | 'rear' | 'interior';
  /** For a dealership photo, the part of the place it shows. */
  view?: 'exterior' | 'interior' | 'lounge' | 'delivery' | 'team';
  /**
   * Several photographs laid out in one image. Worth saying, because a video model
   * will happily film a contact sheet if it is not told the thing is a record.
   */
  sheet?: boolean;
  /**
   * A different model from the one this film is about — another car in the range,
   * attached for the scenes that name it.
   *
   * It is never a reference for the film's own vehicle. Sent as one, a Kwid's older
   * face and the maker's older emblem were blended into a Kiger, in every part.
   */
  otherModel?: boolean;
}

export interface Dealer {
  id?: string;
  /** A dealership, or the manufacturer. Unset is a dealership. */
  kind?: ClientKind;
  /** The dealership's trading name, or the marque. */
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
  /* ---- a manufacturer's own identity, unset for a dealership ---- */
  /** The brand line that closes a film. */
  tagline?: string;
  /** Where the film sends the viewer, in place of a dealership's address and phone. */
  website?: string;
  segment?: OemSegment;
  /** How this brand's own films look and sound, in the team's words. */
  styleNote?: string;
}

/** The language rules in force for this brief, resolved from the library. */
export interface BriefLanguage {
  code: string;
  name: string;
  /** True when lines must be respelled for pronunciation before generation. */
  needsPhonetics?: boolean;
  /** On-screen text rules, injected into the video prompt. */
  writtenGuide?: string;
}

/**
 * The brand's current line-up, used when no single model was chosen.
 *
 * Without it a model-agnostic brief left the video model free to invent a car,
 * and it reliably reached for an older generation it had seen more of. Naming
 * the real range keeps it inside what the dealer actually sells.
 */
export interface BrandLineup {
  brand: string;
  /** Cars or two-wheelers — the same badge sells both. */
  kind: 'car' | 'bike';
  /** Model names as the library holds them, e.g. "Punch", "Nexon". */
  models: string[];
}

/** The structured brief — the single user input (P0.3). */
/** One logo's place on the film: a top corner, or not shown at all. */
export type LogoSlot = 'left' | 'right' | 'off';

export interface LogoPlacement {
  brand: LogoSlot;
  dealer: LogoSlot;
}

export interface Brief {
  /** Set when the brief names no specific model. */
  lineup?: BrandLineup;
  /** Other models the same film features, beyond the hero in `carModel`. */
  alsoFeatured?: string[];
  /** Resolved from the project's chosen LanguageProfile. */
  language?: BriefLanguage;
  categories: CategoryId[];
  narration: NarrationKey;
  /** Whether the video references a specific car model (triggers the scraper, P0.2). */
  modelSpecific: boolean;
  /** False when this film deliberately has nobody on camera, whatever the narration mode. */
  useActor?: boolean;
  /** Where the client's logos go on the film. Unset: brand top-left, dealership top-right. */
  logoPlacement?: LogoPlacement;
  carModel?: string;
  /**
   * The hero car's paint, as a person says it ("Stealth Black"). The library's
   * angle photos are often shot in one launch colour, so without this the model
   * paints the car whatever colour its reference photos happen to be.
   */
  carColour?: string;
  /** What the showroom sells. Two-wheelers are ridden: "test ride", never "test drive". */
  vehicleKind?: 'car' | 'bike';
  /**
   * The vehicle photos were attached to this project rather than taken from the library:
   * they are the only thing the model may build the vehicle from.
   */
  attachedCarPhotos?: boolean;
  /** Storyboard scenes the designer deleted, by beat key. */
  omitScenes?: string[];
  /**
   * The order the designer put the scenes in, by beat key. A scene not named
   * here keeps its natural place after the ones that are, so a use case added
   * later does not vanish.
   */
  sceneOrder?: string[];
  /** Scenes written by hand in the storyboard, in the order they were added. */
  addedScenes?: Beat[];
  /** Delivery speed. 1 is a natural read; 1.1 says the same script 10% faster, in a film 10% shorter. */
  pace?: number;
  /**
   * How fast the voice speaks, in words a minute. Decides both how the delivery is
   * described to the model and how many words a scene's seconds are worth, so a
   * faster read genuinely buys more to say. See SPEECH_RATES.
   */
  speechWpm?: number;
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
  /** The colours the captions, footer strip and end card are drawn in. Unset is Midnight. */
  overlayTheme?: OverlayTheme;
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
