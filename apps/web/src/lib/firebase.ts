/**
 * Google sign-in.
 *
 * This config is public by design — a Firebase web config identifies the
 * project, it does not authorise anything. Authority comes from the ID token the
 * browser sends and the role the server reads from Firestore.
 *
 * The ID token expires hourly, so rather than reading it per request we keep the
 * current one here and let Firebase refresh it in the background.
 */

import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onIdTokenChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';

const app = initializeApp({
  apiKey: 'AIzaSyDueG9ne8gyK92UXDeXH1CktQ131dJ2oMU',
  authDomain: 'ai-video-app-cd.firebaseapp.com',
  projectId: 'ai-video-app-cd',
  storageBucket: 'ai-video-app-cd.firebasestorage.app',
  messagingSenderId: '85831607354',
  appId: '1:85831607354:web:71309ddd6e96405a59c103',
});

export const auth = getAuth(app);

let currentToken: string | null = null;
export const googleToken = (): string | null => currentToken;

/** Fires on sign-in, sign-out and every silent hourly refresh. */
export function watchGoogleAuth(onChange: (user: User | null) => void): () => void {
  return onIdTokenChanged(auth, async (user) => {
    currentToken = user ? await user.getIdToken().catch(() => null) : null;
    onChange(user);
  });
}

export async function signInWithGoogle(): Promise<{ ok: true } | { ok: false; message: string }> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
      return { ok: false, message: '' };
    }
    if (err.code === 'auth/operation-not-allowed') {
      return {
        ok: false,
        message:
          'Google sign-in is not switched on for this project yet. An admin needs to enable it in Firebase Console → Authentication → Sign-in method → Google.',
      };
    }
    if (err.code === 'auth/unauthorized-domain') {
      return { ok: false, message: `${location.hostname} is not an authorised domain in Firebase Authentication.` };
    }
    return { ok: false, message: err.message ?? 'Google sign-in failed.' };
  }
}

export const signOutGoogle = (): Promise<void> => fbSignOut(auth);
