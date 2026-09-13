/**
 * Client for the Cloud Run backend (@ava/api).
 * /api/generate runs the create-then-extend chain on Omni Flash and returns
 * clip URLs served back through /api/clips/:jobId/:part.
 */

import type { Brief, PromptPart, DealerPhoto, BriefPlan } from '@ava/shared';
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
  status: 'running' | 'done' | 'failed' | 'cancelled';
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
  /** Start to finished video, in ms. Absent on runs that never finished. */
  durationMs?: number;
  /** Set when the video was upscaled — what the model actually rendered. */
  renderResolution?: string;
  /** Which vehicle this run was told to show, and how much of it the model was shown. */
  vehicle?: { model?: string; colour?: string; photos: number; attached: boolean; angles: string[] };
  /** Whether this run kept a copy of the project, so its settings can be put back. */
  restorable?: boolean;
  /** How this video came about: made, retaken, or a version of one that exists. */
  kind?: 'generate' | 'retake' | 'restitch' | 'enhance' | 'upscale' | 'edit';
  /** The cut the client signed off. One per project. */
  approved?: boolean;
  derivedFrom?: string;
  derivedNote?: string;
}

/** One run in full — what it was made from, and what each part was shown. */
export interface GenerationDetail {
  jobId: string;
  createdAt: number;
  label?: string;
  modelName?: string;
  modelId?: string;
  status: string;
  vehicle?: GenerationHistoryItem['vehicle'];
  /** What the vehicle checker made of each part, and whether it had to be made again. */
  vehicleChecks: { part: number; same: boolean; why: string; remade?: boolean }[];
  referenceFiles: { part: number; files: string[] }[];
  prompts: { part: number; text: string }[];
  brief: Record<string, unknown> | null;
  sceneEdits: Record<string, unknown> | null;
  projectSnapshot: Record<string, unknown> | null;
  feedback?: string;
  parentJobId?: string;
}

export interface ScriptLineView {
  index: number;
  /** The scene's key — lines are filed under it. */
  key?: string;
  line: string;
  say: string;
}

export interface GenerateResult {
  jobId: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
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
    /** Storyboard edits — the server needs the edited captions to composite them. */
    sceneOverrides?: Record<string, unknown>,
    /** Named by the browser so the run can be stopped while this request is still open. */
    jobId?: string,
  ) {
    const r = await req<GenerateResult>('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        brief,
        parts,
        confirmedCostInr,
        modelId,
        sceneOverrides,
        jobId,
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

  /**
   * Stop a run. No provider can be interrupted mid-render, so it stops after the part
   * it is on; what is already made is stitched and kept.
   */
  async stop(jobId: string) {
    return await req<{ ok: boolean; status: string }>(`/api/generate/${jobId}/stop`, { method: 'POST', body: '{}' });
  },

  /**
   * Read the brief and propose the project — use cases, their fields, the vehicle, the
   * presenter, the call to action. What is written into the project is decided by
   * applyBriefPlan, which only fills what the designer left blank.
   */
  async plan(prompt: string, clientId?: string) {
    return await req<BriefPlan>('/api/projects/plan', {
      method: 'POST',
      body: JSON.stringify({ prompt, clientId }),
    });
  },

  /** Every generation for a project, newest first — nothing is overwritten. */
  /** Mark (or unmark) the cut the client signed off. */
  async approve(jobId: string, approved: boolean) {
    return await req<{ ok: true; approved: boolean }>(`/api/generations/${jobId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    });
  },

  /** The same film, larger. No model, no drift, no cost. */
  async upscale(jobId: string, resolution: string) {
    return await req<{ jobId: string; finalUrl: string }>(`/api/generations/${jobId}/upscale`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    });
  },

  /** Re-render the approved film through Seedance for finish. */
  async enhance(jobId: string, modelId?: string) {
    return await req<{ jobId: string; finalUrl: string; cost?: { inr: number } }>(
      `/api/generations/${jobId}/enhance`,
      { method: 'POST', body: JSON.stringify({ modelId }) },
    );
  },

  /** Export a trimmed version of a finished film. */
  async editVideo(jobId: string, body: { keep: { from: number; to: number }[]; mute?: boolean; note?: string }) {
    return await req<{ jobId: string; finalUrl: string }>(`/api/generations/${jobId}/edit`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** Everything one run was made from — the receipt behind a finished video. */
  async generation(jobId: string): Promise<GenerationDetail | null> {
    const r = await req<GenerationDetail>(`/api/generations/${jobId}`);
    return isApiError(r) ? null : r;
  },

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
    sceneOverrides?: Record<string, unknown>,
    /** Images attached to the retake — what the vehicle must look like in the parts redone. */
    attachments?: { storagePath?: string; refId?: string; label?: string }[],
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
        sceneOverrides,
        attachments,
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
    return await req<{
      model: string;
      lines: ScriptLineView[];
      angle?: { viewer: string; idea: string; throughline: string; proof: string[] };
    }>('/api/script', {
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

  /**
   * How long a run should take, learned from this app's own finished runs on the
   * same model. No provider reports progress, so history is the only honest source.
   */
  async eta(q: { modelId?: string; resolution: string; seconds: number; parts: number }) {
    const qs = new URLSearchParams({
      ...(q.modelId ? { modelId: q.modelId } : {}),
      resolution: q.resolution,
      seconds: String(q.seconds),
      parts: String(q.parts),
    });
    return await req<{ seconds: number; basis: 'history' | 'default'; samples: number }>(
      `/api/generate/eta?${qs.toString()}`,
    );
  },

  async job(jobId: string) {
    const r = await req<GenerateResult>(`/api/generate/${jobId}`);
    if (isApiError(r)) return r;
    return hydrate(r);
  },

};
