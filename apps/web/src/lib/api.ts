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

  async generate(brief: Brief, parts: PromptPart[], confirmedCostInr?: number, modelId?: string) {
    const r = await req<GenerateResult>('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ brief, parts, confirmedCostInr, modelId }),
    });
    if (isApiError(r)) {
      r.clips = errorClips(r).map((c) => ({ ...c, url: absolute(c.url) }));
      if (r.finalUrl) r.finalUrl = absolute(r.finalUrl);
      return r;
    }
    return hydrate(r);
  },

  async job(jobId: string) {
    const r = await req<GenerateResult>(`/api/generate/${jobId}`);
    if (isApiError(r)) return r;
    return hydrate(r);
  },

};
