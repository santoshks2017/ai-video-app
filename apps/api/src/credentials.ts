/**
 * Provider API keys.
 *
 * The key value lives in its own Firestore collection that the API never reads
 * back to a client — list/get responses only ever carry `hasKey`. Firestore
 * rules are deny-all, so the browser cannot reach it directly either; the only
 * reader is the generation path on the server (PRD P0.1: the key is never
 * present in any browser-inspectable request or response).
 *
 * Secret Manager would be marginally better, but that needs a project-wide
 * secretmanager.admin grant on the runtime service account to create secrets on
 * demand — a much broader permission than this collection.
 */

import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebase } from './store.js';

const COLLECTION = 'credentialSecrets';

export async function putCredentialKey(credentialId: string, key: string): Promise<void> {
  ensureFirebase();
  await getFirestore().collection(COLLECTION).doc(credentialId).set({
    key,
    updatedAt: Date.now(),
  });
}

export async function getCredentialKey(credentialId: string): Promise<string | undefined> {
  ensureFirebase();
  const snap = await getFirestore().collection(COLLECTION).doc(credentialId).get();
  const v = snap.exists ? (snap.data()?.key as string | undefined) : undefined;
  return v && v.trim() ? v : undefined;
}

export async function deleteCredentialKey(credentialId: string): Promise<void> {
  ensureFirebase();
  await getFirestore().collection(COLLECTION).doc(credentialId).delete();
}

/** Never let a key escape through an API response. */
export function scrub<T extends Record<string, unknown>>(doc: T): T {
  const { key, apiKey, secret, ...rest } = doc as Record<string, unknown>;
  void key;
  void apiKey;
  void secret;
  return rest as T;
}
