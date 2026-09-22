/**
 * An image project: a brief for social creatives and the creatives it made.
 *
 * Kept in its own collection, `imageProjects`, beside the video projects rather than among
 * them: the video board, a client's campaigns and analytics read video fields from every
 * project they see, and an image project has none.
 */
import type { CreativeDoc, CreativeFormatId, PictureAspect } from './creative.js';
import type { CreativeCopy, CreativeLookChoice } from './creativeCopy.js';
import type { DesignWords, LogosVerdict, WordsVerdict } from './creativeDesign.js';
import type { CreativeEngineId, CreativeTemplateId } from './creativeEngines.js';
import type { PanelStyle } from './creativeLayout.js';
import type { ProjectStage, StoredImage } from './library.js';

/** What an attached image is to the project — read by the intake model, flippable by hand. */
export type ImageRole = 'vehicle' | 'creative' | 'moment' | 'logo';
/** What to do with an attached finished creative. */
export type ReferenceIntent = 'recreate' | 'edit' | 'sizes';
/** A photo attached to the project, with what it is. */
export type AttachedPhoto = StoredImage & { role?: ImageRole };

/** A picture the image model drew for one aspect ratio, with the vehicle check's verdict. */
export interface ScenePicture {
  image: StoredImage;
  check?: { same: boolean; checked: boolean; why?: string };
  model?: string;
  at: number;
}

/** A size someone has opened in the editor and changed; it keeps their changes from then on. */
export interface ImageCreative {
  id: string;
  format: CreativeFormatId;
  doc: CreativeDoc;
  approved?: boolean;
  /** The picture as last exported, when it was saved. */
  png?: StoredImage;
  updatedAt: number;
}

/** A finished creative Nano Banana 2 designed for one size, with what the checks found. */
export interface DesignedCreative {
  image: StoredImage;
  /** The words it was asked to set — to tell when the copy has moved on since. */
  words: DesignWords;
  checks: {
    vehicle: { same: boolean; checked: boolean; why?: string };
    words: WordsVerdict;
    /** Whether the client's logos stayed where they were put, and no other logo was added. */
    logos?: LogosVerdict;
  };
  /** The canvas it was designed on, with the logos in place — what a change is checked against. */
  skeleton?: StoredImage;
  model: string;
  /** Its pixels, as it came back. */
  width?: number;
  height?: number;
  /** The change last asked for, when it was revised rather than made afresh. */
  revision?: string;
  at: number;
}

/**
 * Where a creative's picture comes from. `design`: Nano Banana 2 designs the whole creative,
 * words included, and the app lays the logos and panel on it. The rest are pictures with the
 * words laid over them as layers: a scene, the photo as it is, or an upload.
 */
export type PictureMode = 'design' | 'scene' | 'photo' | 'upload';

export interface ImageProject {
  id: string;
  name: string;
  clientId?: string;
  /** The model the post is about. */
  carId?: string;
  carColour?: string;
  /** The photo the picture is built on: a library photo or an attached one. */
  heroPhoto?: StoredImage;
  /** Photos attached to this project, which take the library's place. */
  attachedPhotos?: AttachedPhoto[];
  /** An earlier creative to build from: recreate it, change elements, or make its other sizes. */
  reference?: { image: StoredImage; intent: ReferenceIntent; changes?: string };
  /** What the intake read, when, and how sure it was. */
  intake?: { at: number; heard: string[]; confidence?: 'high' | 'low'; model?: string; fallback?: boolean };
  /** What the post is about, in the designer's words. */
  prompt: string;
  /** The engine the brief was read as, or picked by hand. */
  engine?: { primary: CreativeEngineId; secondary?: CreativeEngineId; ratio?: string; manual?: boolean };
  /** The engine's facts. A list is its rows, one per line. */
  facts: Record<string, string>;
  /** The language of the words on the picture: a language id, or 'hinglish'. */
  languageId?: string;
  /** Signature phrases, things to avoid, how the client sounds. */
  voiceNote?: string;
  formats: CreativeFormatId[];
  look: CreativeLookChoice;
  /** Unset: the engine's own. */
  templateId?: CreativeTemplateId;
  panelStyle: PanelStyle;
  copy?: CreativeCopy;
  pictureMode: PictureMode;
  /** More direction for the scene. */
  sceneNote?: string;
  pictures?: Partial<Record<PictureAspect, ScenePicture>>;
  /** What Nano Banana 2 designed, size by size. */
  designs?: Partial<Record<CreativeFormatId, DesignedCreative>>;
  upload?: StoredImage;
  /** The sizes opened in the editor and changed. The rest are laid out from the brief each time. */
  creatives: ImageCreative[];
  stage?: ProjectStage;
  /** Kept by the server as it spends: admins see it. */
  totalCostInr?: number;
  generationCount?: number;
  createdAt: number;
  updatedAt: number;
}

export function emptyImageProject(): Omit<ImageProject, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Untitled creative',
    prompt: '',
    facts: {},
    formats: ['ig-square', 'ig-portrait', 'story'],
    look: { source: 'theme', themeId: 'midnight' },
    panelStyle: 'full',
    pictureMode: 'design',
    creatives: [],
  };
}

/** The size a new creative is proved on before the rest are paid for. */
export const PROOF_FORMAT: CreativeFormatId = 'ig-square';

/** A project with nothing made yet opens on the intake; anything made opens the workspace. */
export const showIntake = (p: ImageProject): boolean =>
  !p.creatives.length && !Object.keys(p.designs ?? {}).length && !Object.keys(p.pictures ?? {}).length;

/** A list fact's rows. */
export const factRows = (v: string | undefined): string[] => (v ?? '').split('\n').map((r) => r.trim()).filter(Boolean);
