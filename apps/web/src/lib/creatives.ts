import type {
  CopyClient,
  CreativeCopy,
  CreativeEngineId,
  CreativeFormatId,
  CreativeTemplateId,
  DesignWords,
  DesignZones,
  DesignedCreative,
  ImageRole,
  PictureAspect,
  ReferenceIntent,
  StoredImage,
} from '@ava/shared';
import { post } from './client.js';

/** What the copy writer is told: the engine, the brief and its facts, the client and the car, the language. */
export interface CopyRequest {
  engine: { primary: CreativeEngineId; secondary?: CreativeEngineId; ratio?: string };
  prompt: string;
  facts: Array<{ label: string; value: string }>;
  client: CopyClient & { segment?: string; styleNote?: string };
  vehicle?: { model: string; brand?: string; colour?: string; highlights?: string[] };
  language: { name: string; script: 'latin' | 'indic'; hinglish?: boolean; guide?: string };
  voiceNote?: string;
  occasion?: string;
  validity?: string;
}

export interface SceneRequest {
  aspect: PictureAspect;
  engine: CreativeEngineId;
  occasion?: string;
  vehicle: { name: string; colour?: string; kind?: 'car' | 'bike' };
  note?: string;
  textBand: 'top' | 'left';
  band?: number;
  panel: boolean;
  mood?: { panel: string; accent: string };
  /** Set by the server; the web sends the master separately. */
  match?: boolean;
}

export const writeCreativeCopy = (projectId: string, request: CopyRequest) =>
  post<{ copy: CreativeCopy; model: string }>('/api/creatives/copy', { projectId, request });

export const drawCreativeScene = (projectId: string, scene: SceneRequest, photos: Array<{ storagePath: string; label: string }>, match?: { storagePath: string }) =>
  post<{ image: StoredImage; check: { same: boolean; checked: boolean; why?: string }; model: string }>('/api/creatives/scene', {
    projectId,
    scene,
    photos,
    ...(match ? { match } : {}),
  });

/** A whole creative for one size, designed by Nano Banana 2 — see the server's DesignRequest. */
export interface DesignRequest {
  format: CreativeFormatId;
  engine: CreativeEngineId;
  secondary?: CreativeEngineId;
  template?: CreativeTemplateId;
  occasion?: string;
  vehicle: { name: string; colour?: string; kind?: 'car' | 'bike' };
  note?: string;
  words: DesignWords;
  language: { name: string; script: 'latin' | 'indic' };
  look: { panel: string; accent: string };
  zones: DesignZones;
  /** An image the design builds from — see the server's DesignReferenceKind. */
  reference?: { storagePath: string; kind: 'style' | 'master' | 'base-photo'; changes?: string };
}

export type DesignResult = Pick<DesignedCreative, 'image' | 'words' | 'checks' | 'model' | 'width' | 'height' | 'revision'>;

export const drawCreativeDesign = (projectId: string, design: DesignRequest, photos: Array<{ storagePath: string; label: string }>) =>
  post<DesignResult>('/api/creatives/design', { projectId, design, photos });

export const reviseCreativeDesign = (projectId: string, design: DesignRequest, image: { storagePath: string }, change: string, photos: Array<{ storagePath: string; label: string }>) =>
  post<DesignResult>('/api/creatives/revise', { projectId, design, image, change, photos });

/** What the intake is given to read. */
export interface UnderstandRequest {
  brief: string;
  client?: { name: string; brand?: string };
  vehicles: Array<{ id: string; name: string }>;
  languages: Array<{ id: string; name: string }>;
  images: Array<{ label?: string }>;
}

/** What the intake understood — everything already checked against what the app knows. */
export interface Interpretation {
  engine: { primary: CreativeEngineId; secondary?: CreativeEngineId; ratio?: string };
  heard: string[];
  confidence: 'high' | 'low';
  occasion?: string;
  carId?: string;
  colour?: string;
  facts: Record<string, string>;
  languageId?: string;
  sizes?: CreativeFormatId[];
  sceneNote?: string;
  images: Array<{ index: number; role: ImageRole; note?: string }>;
  referenceIntent?: ReferenceIntent;
  changes?: string;
  copy?: CreativeCopy;
}

export const understandBrief = (projectId: string, request: UnderstandRequest, images: Array<{ storagePath: string; label?: string }>) =>
  post<{ interpretation: Interpretation; model: string }>('/api/creatives/understand', { projectId, request, images });
