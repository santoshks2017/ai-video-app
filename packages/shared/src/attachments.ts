/**
 * Attachment / reference-image labelling (PRD P0.4). Every uploaded or scraped
 * image gets a required short label and a stable filename; the master prompt
 * cites images by filename, never by prose re-description.
 */

import type { DealerPhoto } from './types.js';

/** Turn a human label into a stable, prompt-safe filename stem. */
export function filenameFromLabel(label: string, kind: DealerPhoto['kind'], ext = 'jpg'): string {
  const stem =
    String(label ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || kind;
  return `${stem}.${ext}`;
}

/** Ensure filenames are unique within a set (append _2, _3 …). */
export function dedupeFilenames(photos: DealerPhoto[]): DealerPhoto[] {
  const seen = new Map<string, number>();
  return photos.map((p) => {
    const base = p.filename || filenameFromLabel(p.label, p.kind);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (n === 1) return { ...p, filename: base };
    const dot = base.lastIndexOf('.');
    const withN = dot === -1 ? `${base}_${n}` : `${base.slice(0, dot)}_${n}${base.slice(dot)}`;
    return { ...p, filename: withN };
  });
}

export interface AttachmentIssue {
  filename: string;
  problem: 'missing-label';
}

/** Every attachment must carry a non-empty label (P0.4 acceptance). */
export function validateAttachments(photos: DealerPhoto[]): AttachmentIssue[] {
  return photos
    .filter((p) => !String(p.label ?? '').trim())
    .map((p) => ({ filename: p.filename, problem: 'missing-label' as const }));
}
