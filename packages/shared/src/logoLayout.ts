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

/**
 * Which logo cleaner a client's stored logos were last put through. Bump it when the
 * cleaning changes: a client whose stored logos are older is cleaned again when it is
 * opened, so the copies Clients shows match what the films draw. 2 is the cleaner
 * that also takes out the background enclosed inside a logo.
 */
export const LOGO_CLEAN_VERSION = 2;
