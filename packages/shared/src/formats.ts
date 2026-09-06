/**
 * Which social formats a given duration + aspect ratio can serve.
 * The brief UI surfaces this so the user picks a duration/dimension knowing
 * what it can post to (workflow diagram: "Shows which formats it can/'t serve").
 */

import type { AspectRatio } from './types.js';

export interface FormatFit {
  fb: boolean;
  ig: boolean;
  yt: boolean;
  notes: string[];
}

/**
 * Rough, deliberately conservative windows:
 *  - IG Reels / FB Reels: best <= 90s, hard cap ~90s; vertical strongly preferred.
 *  - YouTube Shorts: <= 60s, vertical/square.
 *  - Feed posts (FB/IG): any length, but 16:9 / 1:1 read better in feed.
 */
export function formatFit(durationSec: number, aspect: AspectRatio): FormatFit {
  const notes: string[] = [];
  const vertical = aspect === '9:16';
  const square = aspect === '1:1';

  const ig = durationSec <= 90;
  const fb = durationSec <= 90;
  const yt = durationSec <= 60 && (vertical || square);

  if (durationSec <= 60 && vertical) {
    notes.push('Fits Reels and Shorts — the standard dealer ad-slot placement.');
  }
  if (durationSec > 60 && durationSec <= 90) {
    notes.push('Over 60s: serves IG/FB Reels but not YouTube Shorts.');
  }
  if (durationSec > 90) {
    notes.push('Over 90s: feed / in-stream only, not a Reel or Short.');
  }
  if (aspect === '16:9') {
    notes.push('16:9 is feed / YouTube landscape, not a vertical Reel.');
  }
  if (square) {
    notes.push('1:1 works in feed and is a safe Shorts fallback.');
  }
  return { fb, ig, yt, notes };
}

export function formatFitSummary(fit: FormatFit): string {
  const serves = [fit.fb && 'FB', fit.ig && 'IG', fit.yt && 'YT'].filter(Boolean).join(' / ');
  return serves ? `Serves ${serves}` : 'Does not cleanly serve FB / IG / YT at these settings';
}
