/**
 * Thin client for the Cloud Run backend (@ava/api). In this build the generate
 * and scrape endpoints are stubs that return 501 until the Omni Flash key and
 * the scraper are wired (PRD P0.1 / P0.2). The UI is built to degrade cleanly.
 */

import type { Brief, PromptPart } from '@ava/shared';

const BASE = import.meta.env.VITE_API_URL ?? '';

export interface GenerateRequest {
  brief: Brief;
  parts: PromptPart[];
  confirmedCostInr?: number;
}

export interface ApiError {
  ok: false;
  status: number;
  code: string;
  message: string;
}

async function post<T>(path: string, body: unknown): Promise<T | ApiError> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: String(json.code ?? 'error'),
        message: String(json.message ?? res.statusText),
      };
    }
    return json as T;
  } catch (e) {
    return { ok: false, status: 0, code: 'network', message: (e as Error).message };
  }
}

export const api = {
  health: () => fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false),
  generate: (req: GenerateRequest) => post<{ jobId: string }>('/api/generate', req),
  scrape: (models: string[]) => post<{ jobId: string }>('/api/scrape', { models }),
};
