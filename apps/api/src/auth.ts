/**
 * Bearer-token extraction.
 *
 * The shared team password is gone. Everyone signs in with their own Google
 * account, because a shared secret can tell you that a video was generated but
 * never who generated it — and every generation here spends real money. Identity
 * and roles live in users.ts.
 */

export function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m?.[1];
}
