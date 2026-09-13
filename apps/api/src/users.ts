/**
 * Who is calling, and what they are allowed to do.
 *
 * People sign in with Google; the browser sends the Firebase ID token and this
 * verifies it. A person's role lives in Firestore `users/{uid}` and is the only
 * thing that grants permission — the token proves identity, never authority.
 *
 * Everyone who signs in starts as a `viewer`: they can read the libraries and
 * watch finished videos, and that is all. `creator` unlocks the paid actions.
 * `admin` unlocks API credentials, models and the roles themselves.
 *
 * The owner account is named by OWNER_EMAILS on the service. It is made admin on
 * first sign-in and cannot be demoted or deleted, so the app can never be locked
 * out of its own administration.
 */

import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { roleAllows, type AppUser, type Role } from '@ava/shared';
import { ensureFirebase } from './store.js';

const COLLECTION = 'users';

/** The identity a sign-in-free preview acts as. It is not a person and has no users record. */
export const PREVIEW_UID = 'preview-no-sign-in';

export interface Caller {
  uid: string;
  email: string;
  name?: string;
  photo?: string;
  role: Role;
  isOwner: boolean;
}

/**
 * An audit trail. Every sign-in and every paid action is written here against a
 * named account, which is the whole reason the shared password had to go — it
 * could tell you that something happened, never who did it.
 */
export type ActivityType = 'login' | 'generate' | 'retake' | 'script';

export interface Activity {
  uid: string;
  email: string;
  name?: string;
  type: ActivityType;
  at: number;
  detail?: string;
  projectId?: string;
  projectName?: string;
  costInr?: number;
}

const ACTIVITY = 'activity';
/** Repeated requests are not repeated logins; one an hour is the useful signal. */
const LOGIN_GAP_MS = 60 * 60 * 1000;

export async function recordActivity(caller: Caller, a: Omit<Activity, 'uid' | 'email' | 'name' | 'at'>): Promise<void> {
  ensureFirebase();
  const db = getFirestore();
  const entry: Activity = { uid: caller.uid, email: caller.email, name: caller.name, at: Date.now(), ...a };
  await db.collection(ACTIVITY).add(entry).catch(() => {});
  // Running totals on the person, so the admin view never has to scan the log.
  // The sign-in-free preview is not a person — no record to total onto, and none
  // to appear in People. Its spend is still in the log above.
  if (caller.uid !== PREVIEW_UID && (a.costInr || a.type === 'generate' || a.type === 'retake')) {
    await db
      .collection(COLLECTION)
      .doc(caller.uid)
      .set(
        {
          generations: FieldValue.increment(1),
          spendInr: FieldValue.increment(Math.round(a.costInr ?? 0)),
          updatedAt: Date.now(),
        },
        { merge: true },
      )
      .catch(() => {});
  }
}

/**
 * Take a run back off a person's running totals.
 *
 * Hiding a generation is how an admin keeps a bad or duplicated run out of what
 * the team is told it has spent. The log itself is never edited — the entry
 * stays, the totals stop counting it.
 */
export async function uncountRun(uid: string | undefined, costInr: number, runs = 1): Promise<void> {
  if (!uid || uid === PREVIEW_UID) return;
  ensureFirebase();
  await getFirestore()
    .collection(COLLECTION)
    .doc(uid)
    .set(
      {
        generations: FieldValue.increment(-runs),
        spendInr: FieldValue.increment(-Math.round(costInr || 0)),
        updatedAt: Date.now(),
      },
      { merge: true },
    )
    .catch(() => {});
}

export async function listActivity(limit = 200, uid?: string): Promise<Activity[]> {
  ensureFirebase();
  let q = getFirestore().collection(ACTIVITY).orderBy('at', 'desc').limit(limit);
  if (uid) q = getFirestore().collection(ACTIVITY).where('uid', '==', uid).limit(limit);
  const snap = await q.get().catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => d.data() as Activity).sort((a, b) => b.at - a.at);
}

const owners = (): string[] =>
  (process.env.OWNER_EMAILS ?? '')
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const isOwnerEmail = (email: string): boolean => owners().includes(email.trim().toLowerCase());

/** A Firebase ID token is a JWT; the legacy password token is `<expiry>.<hmac>`. */
export const looksLikeIdToken = (token: string): boolean => token.split('.').length === 3;

/**
 * Verify a Google sign-in and return the caller, creating their record the first
 * time they appear. A brand-new person is a viewer unless they are an owner.
 */
export async function resolveIdToken(token: string): Promise<Caller | null> {
  ensureFirebase();
  let decoded: DecodedIdToken;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch {
    return null;
  }
  const email = String(decoded.email ?? '').toLowerCase();
  if (!email) return null;

  const db = getFirestore();
  const ref = db.collection(COLLECTION).doc(decoded.uid);
  const snap = await ref.get();
  const now = Date.now();
  const owner = isOwnerEmail(email);

  if (!snap.exists) {
    const created: AppUser = {
      id: decoded.uid,
      email,
      name: decoded.name ?? undefined,
      photo: decoded.picture ?? undefined,
      role: owner ? 'admin' : 'viewer',
      isOwner: owner,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(created);
    const caller: Caller = {
      uid: decoded.uid,
      email,
      name: created.name,
      photo: created.photo,
      role: created.role,
      isOwner: owner,
    };
    await recordActivity(caller, { type: 'login', detail: 'first sign-in' });
    return caller;
  }

  const existing = snap.data() as AppUser;
  const returning: Caller = {
    uid: decoded.uid,
    email,
    name: decoded.name ?? existing.name,
    photo: decoded.picture ?? existing.photo,
    role: owner ? 'admin' : (existing.role ?? 'viewer'),
    isOwner: owner,
  };
  if (now - (existing.lastSeenAt ?? 0) > LOGIN_GAP_MS) {
    await recordActivity(returning, { type: 'login' });
  }
  await ref
    .set(
      {
        lastSeenAt: now,
        email,
        name: decoded.name ?? existing.name ?? null,
        photo: decoded.picture ?? existing.photo ?? null,
        ...(owner ? { role: 'admin', isOwner: true } : {}),
      },
      { merge: true },
    )
    .catch(() => {});

  return returning;
}

export async function listUsers(): Promise<AppUser[]> {
  ensureFirebase();
  const snap = await getFirestore().collection(COLLECTION).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as AppUser), id: d.id }))
    .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0));
}

export async function setUserRole(uid: string, role: Role): Promise<AppUser | null> {
  ensureFirebase();
  const ref = getFirestore().collection(COLLECTION).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const user = snap.data() as AppUser;
  // The owner keeps admin no matter what the UI sends.
  if (user.isOwner || isOwnerEmail(user.email)) return { ...user, id: uid, role: 'admin' };
  await ref.set({ role, updatedAt: Date.now() }, { merge: true });
  return { ...user, id: uid, role, updatedAt: Date.now() };
}

export async function removeUser(uid: string): Promise<boolean> {
  ensureFirebase();
  const ref = getFirestore().collection(COLLECTION).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const user = snap.data() as AppUser;
  if (user.isOwner || isOwnerEmail(user.email)) return false;
  await ref.delete();
  // Revoking refresh tokens ends their session now rather than in an hour.
  await getAuth().revokeRefreshTokens(uid).catch(() => {});
  return true;
}

export const allows = (caller: Caller | null, needed: Role): boolean =>
  Boolean(caller && roleAllows(caller.role, needed));
