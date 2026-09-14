/**
 * Where a client's logos sit on the film.
 *
 * It used to be fixed: the manufacturer's logo top-left, the dealership's
 * top-right. Clients do not all want that — most want only their own logo, and
 * some want it on the left — so each logo has a place of its own: left, right or
 * off. Unset is the arrangement every film had before.
 */
import type { LogoPlacement, LogoSlot } from './types.js';

export const LOGO_SLOTS: { id: LogoSlot; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'off', label: 'Off' },
];

export function logoLayout(p?: Partial<LogoPlacement> | null): LogoPlacement {
  return { brand: p?.brand ?? 'left', dealer: p?.dealer ?? 'right' };
}

/**
 * The logos in one top corner, in the order they sit: the brand before the
 * dealership, whichever corner they share — the way the pair reads everywhere else.
 */
export function logosOn(
  side: 'left' | 'right',
  layout: LogoPlacement,
  has: { brand: boolean; dealer: boolean } = { brand: true, dealer: true },
): ('brand' | 'dealer')[] {
  return (['brand', 'dealer'] as const).filter((k) => has[k] && layout[k] === side);
}
