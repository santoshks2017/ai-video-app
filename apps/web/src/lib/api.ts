/**
 * Client for the Cloud Run backend (@ava/api).
 * /api/generate runs the create-then-extend chain on Omni Flash and returns
 * clip URLs served back through /api/clips/:jobId/:part.
 */

import type { Brief, PromptPart, DealerPhoto } from '@ava/shared';
import { apiBase as BASE, req, isApiError as sharedIsApiError, type ApiError as SharedApiError } from './client.js';

export interface ClipView {
  partNum: number;
  totalParts: number;
  seconds: number;
  start: number;
  end: number;
  status: 'pending' | 'done' | 'failed';
  error?: string;
  /** The cumulative last clip = the whole finished video. */
  isFinal?: boolean;
  url: string | null;
}

export interface GenerationHistoryItem {
  jobId: string;
  label?: string;
  modelName?: string;
  status: 'running' | 'done' | 'failed';
  createdAt: number;
  totalSeconds?: number;
  costInr?: number;
  costUsd?: number;
  usdPerSecond?: number;
  aspect?: string;
  resolution?: string;
  segments?: number;
  dealerName?: string;
  categories?: string[];
  error?: string;
  finalUrl: string | null;
  posterUrl: string | null;
  /** Set when this run was a retake of an earlier one rather than a fresh video. */
  parentJobId?: string;
  refinedParts?: number[];
  feedback?: string;
}

export interface ScriptLineView {
  index: number;
  line: string;
  say: string;
}

export interface GenerateResult {
  jobId: string;
  status: 'running' | 'done' | 'failed';
  /** The one finished video (stitched if it needed multiple runs). */
  finalUrl?: string | null;
  clips: ClipView[];
  cost?: { inr: number; usd: number };
}

export type ApiError = SharedApiError;
export const isApiError = sharedIsApiError;

/** Error bodies from /api/generate carry the partial clips. */
export const errorClips = (e: ApiError): ClipView[] =>
  Array.isArray(e.clips) ? (e.clips as ClipView[]) : [];

function absolute(url: string | null): string | null {
  return url ? `${BASE}${url}` : null;
}

function hydrate(r: GenerateResult): GenerateResult {
  return {
    ...r,
    finalUrl: absolute(r.finalUrl ?? null),
    clips: r.clips.map((c) => ({ ...c, url: absolute(c.url) })),
  };
}

export const api = {
  health: () => fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null),

  async generate(
    brief: Brief,
    parts: PromptPart[],
    confirmedCostInr?: number,
    modelId?: string,
    project?: { id: string; name: string },
  ) {
    const r = await req<GenerateResult>('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        brief,
        parts,
        confirmedCostInr,
        modelId,
        projectId: project?.id,
        projectName: project?.name,
      }),
    });
    if (isApiError(r)) {
      r.clips = errorClips(r).map((c) => ({ ...c, url: absolute(c.url) }));
      if (r.finalUrl) r.finalUrl = absolute(r.finalUrl);
      return r;
    }
    return hydrate(r);
  },

  /** Every generation for a project, newest first — nothing is overwritten. */
  async history(projectId: string): Promise<GenerationHistoryItem[]> {
    const r = await req<{ items: GenerationHistoryItem[] }>(`/api/projects/${projectId}/generations`);
    if (isApiError(r)) return [];
    return (r.items ?? []).map((i) => ({
      ...i,
      finalUrl: absolute(i.finalUrl),
      posterUrl: absolute(i.posterUrl),
    }));
  },

  /**
   * Retake only the segments listed in `redo`, re-using the rest of that job's
   * saved clips. `redo: []` restitches the stored segments with the current
   * overlay copy — no model call, no cost.
   */
  async refine(
    jobId: string,
    brief: Brief,
    parts: PromptPart[],
    redo: number[],
    feedback: string,
    confirmedCostInr?: number,
    modelId?: string,
    project?: { id: string; name: string },
  ) {
    const r = await req<GenerateResult>(`/api/generate/${jobId}/refine`, {
      method: 'POST',
      body: JSON.stringify({
        brief,
        parts,
        redo,
        feedback,
        confirmedCostInr,
        modelId,
        projectId: project?.id,
        projectName: project?.name,
      }),
    });
    if (isApiError(r)) {
      r.clips = errorClips(r).map((c) => ({ ...c, url: absolute(c.url) }));
      return r;
    }
    return hydrate(r);
  },

  /** Turn the storyboard's stage directions into lines the presenter says. */
  async script(brief: Brief, languageId?: string, projectId?: string) {
    return await req<{ model: string; lines: ScriptLineView[] }>('/api/script', {
      method: 'POST',
      body: JSON.stringify({ brief, languageId, projectId }),
    });
  },

  /** Re-run only the pronunciation pass over copy that is already approved. */
  async phonetics(lines: { index: number; line: string }[], languageId?: string) {
    return await req<{ language: string; lines: ScriptLineView[] }>('/api/script/phonetics', {
      method: 'POST',
      body: JSON.stringify({ lines, languageId }),
    });
  },

  async job(jobId: string) {
    const r = await req<GenerateResult>(`/api/generate/${jobId}`);
    if (isApiError(r)) return r;
    return hydrate(r);
  },

};
