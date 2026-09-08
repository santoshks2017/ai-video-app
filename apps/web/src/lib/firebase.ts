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
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  onIdTokenChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
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

// Survive a reload and the redirect round-trip. Without this a redirect sign-in
// lands back on the page with nothing to show for it.
void setPersistence(auth, browserLocalPersistence).catch(() => {});

/**
 * Finish a redirect sign-in. Harmless when there was no redirect, and the only
 * place a redirect-flow error can surface at all.
 */
export async function completeRedirectSignIn(): Promise<string | null> {
  try {
    await getRedirectResult(auth);
    return null;
  } catch (e) {
    return (e as { message?: string }).message ?? 'Google sign-in failed.';
  }
}

let currentToken: string | null = null;
export const googleToken = (): string | null => currentToken;

/** Fires on sign-in, sign-out and every silent hourly refresh. */
export function watchGoogleAuth(onChange: (user: User | null) => void): () => void {
  return onIdTokenChanged(auth, async (user) => {
    currentToken = user ? await user.getIdToken().catch(() => null) : null;
    onChange(user);
  });
}

/**
 * Sign in with Google.
 *
 * A popup is nicer when it works, but it is also the fragile path: blockers,
 * third-party-cookie rules and stray clicks all kill it, and Firebase reports
 * every one of those as a plain "closed" with nothing to show the user. So any
 * popup failure falls through to a full-page redirect, which always works. The
 * old code swallowed those errors and left the sign-in screen sitting there
 * saying nothing, which looked exactly like a broken app.
 */
export async function signInWithGoogle(): Promise<{ ok: true } | { ok: false; message: string }> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    await signInWithPopup(auth, provider);
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; message?: string };

    if (err.code === 'auth/operation-not-allowed') {
      return {
        ok: false,
        message:
          'Google sign-in is not switched on for this project. An admin needs to enable it in Firebase Console → Authentication → Sign-in method → Google.',
      };
    }
    if (err.code === 'auth/unauthorized-domain') {
      return {
        ok: false,
        message: `${location.hostname} is not an authorised domain in Firebase Authentication → Settings.`,
      };
    }

    // Anything popup-shaped: take the redirect instead. The page navigates away
    // to Google and comes back signed in, so there is nothing to return.
    try {
      await signInWithRedirect(auth, provider);
      return { ok: true };
    } catch (e2) {
      return {
        ok: false,
        message: (e2 as { message?: string }).message ?? err.message ?? 'Google sign-in failed.',
      };
    }
  }
}

export const signOutGoogle = (): Promise<void> => fbSignOut(auth);
