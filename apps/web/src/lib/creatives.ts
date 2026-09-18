import type { CopyClient, CreativeCopy, CreativeEngineId, PictureAspect, StoredImage } from '@ava/shared';
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
}

export const writeCreativeCopy = (projectId: string, request: CopyRequest) =>
  post<{ copy: CreativeCopy; model: string }>('/api/creatives/copy', { projectId, request });

export const drawCreativeScene = (projectId: string, scene: SceneRequest, photos: Array<{ storagePath: string; label: string }>) =>
  post<{ image: StoredImage; check: { same: boolean; checked: boolean; why?: string }; model: string }>('/api/creatives/scene', {
    projectId,
    scene,
    photos,
  });
