/**
 * Authenticated API client. Every request carries the signed-in person's Google
 * ID token, refreshed hourly by Firebase — so every action is attributable to a
 * named account, which a shared password could never be.
 */

import { freshToken, googleToken } from './firebase.js';

const BASE = import.meta.env.VITE_API_URL ?? '';

export const apiBase = BASE;
/** Synchronous best-effort, for callers that cannot await. */
export const getToken = (): string | null => googleToken();

export interface ApiError {
  ok: false;
  status: number;
  code: string;
  message: string;
  /** Route-specific extras the server attaches to an error body. */
  jobId?: string;
  finalUrl?: string | null;
  clips?: unknown;
}

export function isApiError(x: unknown): x is ApiError {
  return !!x && typeof x === 'object' && (x as ApiError).ok === false;
}

/** Absolute URL for a server-relative path (clips, reference images). */
/**
 * An API path made absolute — and left alone when it already is.
 *
 * Photos imported from Google and uploaded by hand are stored with the full URL
 * on them, while the vehicle library stores the path. Prefixing the base onto
 * both turned the first kind into `https://host/https://host/api/refs/…`, which
 * is why the presenter and every showroom photo showed a broken thumbnail while
 * the car sheets beside them loaded.
 */
export const abs = (p: string | null | undefined): string | null =>
  !p ? null : /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(p) ? p : `${BASE}${p}`;

export async function req<T>(path: string, init: RequestInit = {}): Promise<T | ApiError> {
  try {
    const token = await freshToken();
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        // Only a request with a body says it is JSON. The server turns away an empty
        // body labelled JSON, which is what made every delete fail.
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: String(json.code ?? 'error'),
        message: String(json.message ?? (res.statusText || 'Request failed')),
        jobId: json.jobId as string | undefined,
        finalUrl: json.finalUrl as string | null | undefined,
        clips: json.clips,
      };
    }
    return json as T;
  } catch (e) {
    return { ok: false, status: 0, code: 'network', message: (e as Error).message };
  }
}

export const get = <T,>(p: string) => req<T>(p);
export const post = <T,>(p: string, body: unknown) =>
  req<T>(p, { method: 'POST', body: JSON.stringify(body) });
export const patchReq = <T,>(p: string, body: unknown) =>
  req<T>(p, { method: 'PATCH', body: JSON.stringify(body) });
export const del = (p: string) => req<{ ok: boolean }>(p, { method: 'DELETE' });

/* ---------------- session ---------------- */

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  photo?: string;
  role: 'viewer' | 'creator' | 'admin';
  isOwner?: boolean;
  legacy?: boolean;
}

export const session = {
  status: () =>
    get<{ authEnabled: boolean; signedIn: boolean; previewOpen?: boolean; user: SessionUser | null }>('/api/session'),
};

/* ---------------- generic collection CRUD ---------------- */

export function collection<T extends { id: string }>(name: string) {
  return {
    list: async (): Promise<T[]> => {
      const r = await get<{ items: T[] }>(`/api/${name}`);
      return isApiError(r) ? [] : (r.items ?? []);
    },
    save: (item: Partial<T>) => post<T>(`/api/${name}`, item),
    patch: (id: string, fields: Partial<T>) => patchReq<T>(`/api/${name}/${id}`, fields),
    remove: (id: string) => del(`/api/${name}/${id}`),
  };
}

/**
 * Look at a vehicle's photos again and file each under what it shows. The
 * library was built from CarDekho's filenames, and those are a guess.
 */
export async function recheckCarPhotos(id: string) {
  return await post<{ ok: true; moved: string[]; dropped: string[]; angles: string[] }>(
    `/api/cars/${id}/recheck`,
    {},
  );
}

/** One model's day: what the app has sent it, its limit, and whether it is spent. */
export interface ModelUsageItem {
  id: string;
  modelId: string;
  requests: number;
  limit: number | null;
  exhausted: boolean;
}

/** How much of today each model has left, and when the day turns (midnight Pacific). */
export async function getModelUsage() {
  return await get<{ resetsAt: number; items: ModelUsageItem[] }>('/api/models/usage');
}

/**
 * Read a vehicle's colours again without touching its photographs. The sync once
 * stopped at ten colours; this puts back what it cut and keeps every photo as filed.
 */
export async function refreshCarColours(id: string) {
  return await post<{ ok: true; count: number; added: string[] }>(`/api/cars/${id}/colours`, {});
}

/**
 * File a dealership's photos by the part of the place they show, and build one
 * sheet per part. Photos already filed by hand keep what they were given.
 */
export async function buildClientSheets(id: string, relabel = false) {
  return await post<{
    ok: true;
    counts: Record<string, number>;
    sheets: string[];
    unfiled: number;
    looked: number;
    note?: string;
  }>(`/api/clients/${id}/sheets`, { relabel });
}

/**
 * Clean a client's saved logos — background off, a white version made — and pull the
 * brand's logo when it has none, or when asked for again.
 */
export async function cleanClientLogos(id: string, pullBrand = false) {
  return await post<{ ok: true; notes: string[]; pulled: boolean }>(`/api/clients/${id}/logos`, { pullBrand });
}

/* ---------------- reference-image upload ---------------- */

/** Fill an actor's profile in from a description. Nothing is saved until the actor is. */
export async function fillActorProfile(description: string, current: Partial<import('@ava/shared').ActorProfile>) {
  return await post<{ fill: import('@ava/shared').ActorFill; model: string }>('/api/actor-profile/fill', { description, current });
}

/** Draw an actor's profile sheet. It comes back stored, ready to be the reference photo. */
export async function drawActorProfile(
  actor: Partial<import('@ava/shared').ActorProfile>,
  opts: { setting?: string; keepFace?: boolean },
) {
  const r = await post<{ photo: { refId: string; storagePath: string; filename: string; label: string }; model: string }>(
    '/api/actor-profile/draw',
    { actor, ...opts },
  );
  if (isApiError(r)) return r;
  return { model: r.model, photo: { ...r.photo, url: `${BASE}/api/${r.photo.storagePath}` } };
}

export async function uploadRef(file: File, label: string, kind = 'dealer') {
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  const r = await post<{
    refId: string;
    storagePath: string;
    filename: string;
    label: string;
    /** A logo comes back with its background removed, and a white version for dark backgrounds. */
    white?: { refId: string; storagePath: string; filename: string; label: string };
  }>('/api/refs', { filename: file.name, contentType: file.type || 'image/jpeg', label, kind, dataBase64 });
  if (isApiError(r)) return r;
  return {
    refId: r.refId,
    storagePath: r.storagePath,
    filename: r.filename,
    label: r.label,
    // Link to the name storage actually keeps, not the name it was uploaded as.
    url: `${BASE}/api/${r.storagePath}`,
    ...(r.white ? { white: { ...r.white, url: `${BASE}/api/${r.white.storagePath}` } } : {}),
  };
}
