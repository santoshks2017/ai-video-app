/**
 * Keys for the engine API — how another app proves it may ask this one for a
 * picture or a film.
 *
 * A key is shown once, when it is made, and never again: what is kept is its
 * hash, the few characters that let a person recognise it in a list, and what it
 * has spent. So a leaked key can be revoked, a noisy one can be capped, and
 * every rupee the engine spends has a name against it.
 *
 * The people who use the app sign in with Google; the apps that use the engine
 * carry a key. Neither can be mistaken for the other.
 */
import crypto from 'node:crypto';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { ensureFirebase } from './store.js';

const COLLECTION = 'apiKeys';
/** Live keys say so in their own name, so one is never mistaken for a test key. */
const PREFIX = 'ava_live_';

export type ApiScope = 'images' | 'videos';

export interface ApiKeyRecord {
  id: string;
  name: string;
  /** The opening of the key, kept so a person can tell two keys apart. */
  hint: string;
  /** SHA-256 of the secret. The secret itself is never stored. */
  hash: string;
  enabled: boolean;
  scopes: ApiScope[];
  /** What this key may spend in a day, in rupees. Unset or 0: no cap of its own. */
  dailyCapInr?: number;
  createdAt: number;
  createdBy?: string;
  lastUsedAt?: number;
  calls?: number;
  costInr?: number;
  /** The day today's spend belongs to, as YYYY-MM-DD in India. */
  day?: string;
  dayCostInr?: number;
}

/** A key as anyone may see it: everything but the hash. */
export type ApiKeyPublic = Omit<ApiKeyRecord, 'hash'>;

const hashOf = (secret: string): string => crypto.createHash('sha256').update(secret).digest('hex');
const publicOf = ({ hash: _hash, ...rest }: ApiKeyRecord): ApiKeyPublic => rest;
/** The day a spend belongs to, in the only time zone this app's days are kept in. */
export const indiaDay = (at = Date.now()): string => new Date(at + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * A new key: 32 random bytes in base64url behind a name that says what it is.
 * The secret goes back to the caller once, and is not recoverable after that.
 */
export async function issueApiKey(
  name: string,
  opts: { scopes?: ApiScope[]; dailyCapInr?: number; createdBy?: string } = {},
): Promise<{ key: ApiKeyPublic; secret: string }> {
  ensureFirebase();
  const secret = `${PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const rec: ApiKeyRecord = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 80) || 'Untitled key',
    hint: `${secret.slice(0, PREFIX.length + 4)}…${secret.slice(-4)}`,
    hash: hashOf(secret),
    enabled: true,
    scopes: opts.scopes?.length ? opts.scopes : ['images', 'videos'],
    ...(opts.dailyCapInr ? { dailyCapInr: Math.max(0, Math.round(opts.dailyCapInr)) } : {}),
    createdAt: Date.now(),
    ...(opts.createdBy ? { createdBy: opts.createdBy } : {}),
    calls: 0,
    costInr: 0,
  };
  await getFirestore().collection(COLLECTION).doc(rec.id).set(rec);
  cache.clear();
  return { key: publicOf(rec), secret };
}

export async function listApiKeys(): Promise<ApiKeyPublic[]> {
  ensureFirebase();
  const snap = await getFirestore().collection(COLLECTION).get();
  return snap.docs
    .map((d) => publicOf(d.data() as ApiKeyRecord))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateApiKey(id: string, patch: Partial<Pick<ApiKeyRecord, 'name' | 'enabled' | 'scopes' | 'dailyCapInr'>>): Promise<void> {
  ensureFirebase();
  await getFirestore().collection(COLLECTION).doc(id).set(patch, { merge: true });
  cache.clear();
}

export async function deleteApiKey(id: string): Promise<void> {
  ensureFirebase();
  await getFirestore().collection(COLLECTION).doc(id).delete();
  cache.clear();
}

/*
 * The key a request carries, looked up once a minute rather than once a call.
 *
 * A picture takes twenty seconds and a film takes minutes, so the extra read is
 * not the cost — but a key that is switched off should stop working while
 * somebody is watching it, not eventually.
 */
const cache = new Map<string, { rec: ApiKeyRecord | null; at: number }>();
const CACHE_MS = 60_000;

/** The key behind a secret, or null when there is none, it is switched off, or it is not a key at all. */
export async function verifyApiKey(secret: string | undefined): Promise<ApiKeyRecord | null> {
  if (!secret || !secret.startsWith(PREFIX) || secret.length < PREFIX.length + 20) return null;
  const hash = hashOf(secret);
  const hit = cache.get(hash);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rec;
  ensureFirebase();
  const snap = await getFirestore().collection(COLLECTION).where('hash', '==', hash).limit(1).get();
  const rec = (snap.docs[0]?.data() as ApiKeyRecord | undefined) ?? null;
  const live = rec && rec.enabled !== false ? rec : null;
  cache.set(hash, { rec: live, at: Date.now() });
  return live;
}

/** What a key has spent today, read fresh — a cap is only a cap if it is current. */
export async function spentToday(id: string): Promise<number> {
  ensureFirebase();
  const doc = await getFirestore().collection(COLLECTION).doc(id).get();
  const rec = doc.data() as ApiKeyRecord | undefined;
  if (!rec) return 0;
  return rec.day === indiaDay() ? (rec.dayCostInr ?? 0) : 0;
}

/** One more call against a key, and what it cost. The day's total starts again each day. */
export async function recordApiUse(id: string, costInr: number): Promise<void> {
  try {
    ensureFirebase();
    const ref = getFirestore().collection(COLLECTION).doc(id);
    const today = indiaDay();
    await getFirestore().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const rec = doc.data() as ApiKeyRecord | undefined;
      if (!rec) return;
      const sameDay = rec.day === today;
      tx.set(
        ref,
        {
          lastUsedAt: Date.now(),
          calls: FieldValue.increment(1),
          costInr: FieldValue.increment(costInr),
          day: today,
          dayCostInr: sameDay ? FieldValue.increment(costInr) : costInr,
        },
        { merge: true },
      );
    });
  } catch {
    /* usage is a record, not a gate: a failed write never fails the call */
  }
}
