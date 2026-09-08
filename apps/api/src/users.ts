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
import { getFirestore } from 'firebase-admin/firestore';
import { roleAllows, type AppUser, type Role } from '@ava/shared';
import { ensureFirebase } from './store.js';

const COLLECTION = 'users';

export interface Caller {
  uid: string;
  email: string;
  name?: string;
  photo?: string;
  role: Role;
  isOwner: boolean;
  /** True for the legacy shared-password session, which acts as an admin. */
  legacy: boolean;
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
    return {
      uid: decoded.uid,
      email,
      name: created.name,
      photo: created.photo,
      role: created.role,
      isOwner: owner,
      legacy: false,
    };
  }

  const existing = snap.data() as AppUser;
  // An owner is always an admin, whatever the stored record says — this is the
  // guarantee that administration cannot be locked out.
  const role: Role = owner ? 'admin' : (existing.role ?? 'viewer');
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

  return {
    uid: decoded.uid,
    email,
    name: decoded.name ?? existing.name,
    photo: decoded.picture ?? existing.photo,
    role,
    isOwner: owner,
    legacy: false,
  };
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
