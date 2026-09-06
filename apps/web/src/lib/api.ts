/**
 * Client for the Cloud Run backend (@ava/api).
 * /api/generate runs the create-then-extend chain on Omni Flash and returns
 * clip URLs served back through /api/clips/:jobId/:part.
 */

import type { Brief, PromptPart } from '@ava/shared';

const BASE = import.meta.env.VITE_API_URL ?? '';

export interface ClipView {
  partNum: number;
  totalParts: number;
  seconds: number;
  start: number;
  end: number;
  status: 'pending' | 'done' | 'failed';
  error?: string;
  url: string | null;
}

export interface GenerateResult {
  jobId: string;
  status: 'running' | 'done' | 'failed';
  clips: ClipView[];
  cost?: { inr: number; usd: number };
}

export interface ApiError {
  ok: false;
  status: number;
  code: string;
  message: string;
  jobId?: string;
  clips?: ClipView[];
}

export function isApiError(x: unknown): x is ApiError {
  return !!x && typeof x === 'object' && (x as ApiError).ok === false;
}

function absolute(url: string | null): string | null {
  return url ? `${BASE}${url}` : null;
}

async function req<T>(path: string, init?: RequestInit): Promise<T | ApiError> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: String(json.code ?? 'error'),
        message: String(json.message ?? res.statusText),
        jobId: json.jobId as string | undefined,
        clips: json.clips as ClipView[] | undefined,
      };
    }
    return json as T;
  } catch (e) {
    return { ok: false, status: 0, code: 'network', message: (e as Error).message };
  }
}

function hydrate(r: GenerateResult): GenerateResult {
  return { ...r, clips: r.clips.map((c) => ({ ...c, url: absolute(c.url) })) };
}

export const api = {
  health: () => fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null),

  async generate(brief: Brief, parts: PromptPart[], confirmedCostInr?: number) {
    const r = await req<GenerateResult>('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ brief, parts, confirmedCostInr }),
    });
    if (isApiError(r)) return r;
    return hydrate(r);
  },

  async job(jobId: string) {
    const r = await req<GenerateResult>(`/api/generate/${jobId}`);
    if (isApiError(r)) return r;
    return hydrate(r);
  },
};
