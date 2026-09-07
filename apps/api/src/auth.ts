/**
 * Shared-password gate. The design team signs in once with a team password;
 * there is no per-user identity (deliberate — see decisions.md).
 *
 * The password never leaves the server. A successful sign-in returns a signed,
 * expiring token; every mutating route requires it. If APP_PASSWORD is unset the
 * gate is OPEN and every response says so, so a misconfigured deploy is obvious
 * rather than silently public.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — internal tool, low friction

/** Secret Manager rejects an empty payload, so 'unset' is the sentinel for "no gate yet". */
function secret(): string {
  const v = (process.env.APP_PASSWORD ?? '').trim();
  return v === 'unset' ? '' : v;
}

export function authEnabled(): boolean {
  return secret().length > 0;
}

function sign(expires: number): string {
  return createHmac('sha256', secret()).update(`ava|${expires}`).digest('hex');
}

export function issueToken(): string {
  const expires = Date.now() + TTL_MS;
  return `${expires}.${sign(expires)}`;
}

export function checkPassword(candidate: string): boolean {
  const expected = Buffer.from(secret());
  const got = Buffer.from(String(candidate ?? ''));
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

export function verifyToken(token: string | undefined): boolean {
  if (!authEnabled()) return true;
  if (!token) return false;
  const [expStr, mac] = String(token).split('.');
  const expires = Number(expStr);
  if (!expires || !mac || Date.now() > expires) return false;
  const expected = Buffer.from(sign(expires));
  const got = Buffer.from(mac);
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

export function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m?.[1];
}
