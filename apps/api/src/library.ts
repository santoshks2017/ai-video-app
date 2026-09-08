/**
 * Firestore CRUD for the library collections (actors, cars, clients, global
 * instructions) and projects. Thin and generic on purpose — the shape lives in
 * @ava/shared, this just persists it.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { ensureFirebase } from './store.js';

export type Collection =
  | 'actors'
  | 'cars'
  | 'clients'
  | 'instructions'
  | 'languages'
  | 'projects'
  | 'credentials'
  | 'models';

interface Timestamped {
  id: string;
  createdAt: number;
  updatedAt: number;
}

function col(name: Collection) {
  ensureFirebase();
  return getFirestore().collection(name);
}

export async function listAll<T>(name: Collection, limit = 500): Promise<T[]> {
  const snap = await col(name).orderBy('updatedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data() as T);
}

export async function getOne<T>(name: Collection, id: string): Promise<T | null> {
  const snap = await col(name).doc(id).get();
  return snap.exists ? (snap.data() as T) : null;
}

/** Create or replace. Generates an id and stamps timestamps. */
export async function upsert<T extends Record<string, unknown>>(
  name: Collection,
  body: T,
): Promise<T & Timestamped> {
  const now = Date.now();
  const rawId = body.id as string | undefined;
  const id = rawId && String(rawId).trim() ? String(rawId) : randomUUID();
  const existing = rawId ? await getOne<Timestamped>(name, id) : null;
  const doc = {
    ...body,
    id,
    createdAt: existing?.createdAt ?? (body.createdAt as number | undefined) ?? now,
    updatedAt: now,
  } as unknown as T & Timestamped;
  await col(name).doc(id).set(stripUndefined(doc));
  return doc;
}

export async function patch<T>(name: Collection, id: string, fields: Partial<T>): Promise<void> {
  await col(name)
    .doc(id)
    .set(stripUndefined({ ...fields, updatedAt: Date.now() }), { merge: true });
}

export async function remove(name: Collection, id: string): Promise<void> {
  await col(name).doc(id).delete();
}

/** Firestore rejects undefined; strip it recursively. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
