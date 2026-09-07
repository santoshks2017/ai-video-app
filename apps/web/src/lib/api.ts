/**
 * Client for the Cloud Run backend (@ava/api).
 * /api/generate runs the create-then-extend chain on Omni Flash and returns
 * clip URLs served back through /api/clips/:jobId/:part.
 */

import type { Brief, PromptPart, DealerPhoto } from '@ava/shared';

const BASE = import.meta.env.VITE_API_URL ?? '';

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

export interface ApiError {
  ok: false;
  status: number;
  code: string;
  message: string;
  jobId?: string;
  finalUrl?: string | null;
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
        finalUrl: json.finalUrl as string | undefined,
        clips: json.clips as ClipView[] | undefined,
      };
    }
    return json as T;
  } catch (e) {
    return { ok: false, status: 0, code: 'network', message: (e as Error).message };
  }
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

  async generate(brief: Brief, parts: PromptPart[], confirmedCostInr?: number) {
    const r = await req<GenerateResult>('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ brief, parts, confirmedCostInr }),
    });
    if (isApiError(r)) {
      if (r.clips) r.clips = r.clips.map((c) => ({ ...c, url: absolute(c.url) }));
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

  async scrapeCarModel(model: string): Promise<DealerPhoto[] | ApiError> {
    const r = await req<{
      results: {
        brand: string;
        model: string;
        status: string;
        note?: string;
        images: { angle: string; storagePath: string; url: string }[];
      }[];
    }>('/api/scrape', { method: 'POST', body: JSON.stringify({ models: [model] }) });
    if (isApiError(r)) return r;
    const first = r.results[0];
    if (!first || !first.images?.length) {
      return {
        ok: false,
        status: 200,
        code: first?.status ?? 'no-images',
        message: first?.note ?? `No reference images found for "${model}" — upload a set manually.`,
      };
    }
    return first.images.map((im) => ({
      label: `${first.model} — ${im.angle}`,
      filename: im.storagePath.split('/').pop() ?? `${im.angle}.jpg`,
      kind: 'car-model' as const,
      storagePath: im.storagePath,
      src: `${BASE}${im.url}`,
    }));
  },

  async uploadRef(file: File, label: string, kind: DealerPhoto['kind']) {
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
    const r = await req<{
      refId: string;
      storagePath: string;
      filename: string;
      label: string;
      kind: string;
    }>('/api/refs', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || 'image/jpeg',
        label,
        kind,
        dataBase64,
      }),
    });
    if (isApiError(r)) return r;
    const photo: DealerPhoto = {
      label: r.label,
      filename: r.filename,
      kind: r.kind as DealerPhoto['kind'],
      refId: r.refId,
      storagePath: r.storagePath,
      src: `${BASE}/api/refs/${r.refId}/${r.filename}`,
    };
    return photo;
  },
};
