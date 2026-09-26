/**
 * What the video model is actually handed, and in what order.
 *
 * A model takes ten images and three videos, and a brief routinely has more than
 * that in scope. Which ones make the cut used to be decided inside the renderer,
 * where nobody could see it — so a designer paid for a run to find out that the
 * photograph they cared about had been eleventh. The rule lives here now: the
 * renderer orders its loaded bytes with it, and the editor orders the brief's
 * attachments with the same function to show the same list before the money is
 * spent. One rule, two readers, no drift.
 */

import { unnamed } from './buildPrompt.js';
import type { Brief, DealerPhoto } from './types.js';

/**
 * What the model is told a picture is, beside the picture.
 *
 * The library calls a photograph by the car's name, and for a person that is the
 * right name — but the model reads this label, and a name is how a model looks a
 * car up. So the renderer says "the car, front" instead, and this is where it is
 * decided: the editor's own list calls the same function, so the panel titled
 * "What the model is handed" says what is handed over rather than what the
 * library happens to call it.
 */
export function sentLabel(a: DealerPhoto, opts: { carModel?: string; vehicleKind?: 'car' | 'bike' } = {}): string {
  const noun = opts.vehicleKind === 'bike' ? 'the bike' : 'the car';
  const plain = (t: string): string => unnamed(t, opts.carModel, opts.vehicleKind === 'bike' ? 'bike' : 'car');
  if (a.emblem) return plain(a.label);
  if (a.kind === 'reference-video') return `a reference video — ${plain(a.label)}`;
  if (a.kind === 'car-model' && a.otherModel) return plain(a.label);
  if (a.kind === 'car-model') {
    // A sheet carries its own warning in the label the brief wrote for it; a single
    // photograph just needs naming by the side it shows.
    return a.sheet ? plain(a.label) : a.angle ? `${noun}, ${a.angle}` : `${noun} — ${plain(a.label)}`;
  }
  if (a.kind === 'actor') return `${a.label} — the same face, hair and clothes in every shot`;
  if (a.kind === 'logo' || a.kind === 'brand-logo') return a.label;
  return a.sheet ? a.label : `${a.kind === 'extra' ? 'a reference for this film' : 'the dealership'} — ${a.label}`;
}

/** What a reference is a picture of. */
export type RefRole = 'scene' | 'vehicle' | 'emblem' | 'presenter' | 'dealership' | 'extra' | 'video' | 'overlay';

export const ROLE_LABEL: Record<RefRole, string> = {
  scene: 'Scene',
  vehicle: 'Vehicle',
  emblem: "Maker's emblem",
  presenter: 'Presenter',
  dealership: 'Dealership',
  extra: 'Extra',
  video: 'Reference video',
  overlay: 'Composited in post',
};

/** Which of those a brief attachment is. */
export function refRole(a: DealerPhoto): RefRole {
  // The emblem is artwork the model is shown, not furniture laid over the cut.
  if (a.emblem) return 'emblem';
  if (a.kind === 'logo' || a.kind === 'brand-logo') return 'overlay';
  if (a.kind === 'reference-video') return 'video';
  // Another model in the range is not a record of the vehicle this film is about,
  // and the renderer does not give it one of the vehicle's slots either.
  if (a.kind === 'car-model') return a.otherModel ? 'extra' : 'vehicle';
  if (a.kind === 'actor') return 'presenter';
  if (a.kind === 'extra') return 'extra';
  return 'dealership';
}

export interface RefSlots<T> {
  /** The frame the part before this one ended on. Always first when there is one. */
  seed?: T;
  /**
   * Stills of the scenes in this part, drawn beforehand from the same photographs.
   * They say what the shot looks like, so they come before the photographs that
   * only say what the subjects look like.
   */
  frames?: T[];
  /** Photographs of the vehicle, best first. These outrank everything. */
  car: T[];
  /** The maker's emblem, in the design it wears today. Right behind the vehicle's face. */
  emblem?: T;
  /** The presenter. Reserved a slot on every part. */
  actor?: T;
  /** The dealership. Reserved a slot on every part. */
  place?: T;
  /** A frame of the vehicle from the opening part — only used when no photo of it exists. */
  anchor?: T;
  /** Everything else in scope: further showroom photos, project extras. */
  rest: T[];
  /** Reference videos. Counted against their own allowance, not the image budget. */
  videos?: T[];
  /** How many images this model takes. */
  max: number;
  /** How many videos it takes. Three, everywhere, today. */
  maxVideos?: number;
}

/**
 * The order, fixed.
 *
 * The vehicle's own photograph comes first, always. A model weighs the images it
 * is given first the most, and everything else in the list — the frame the part
 * before this one ended on, the stills drawn for these scenes — is a picture a
 * model made. Lead with those and a wrong badge or an older generation, drawn
 * once, is copied into every part after it. The photograph is the only record of
 * what the vehicle looks like, so it leads.
 *
 * Three things are guaranteed a slot on every part, because a film missing any of
 * them is unusable: the vehicle, the presenter, the dealership. So the vehicle
 * fills the budget bar two, and those two are held back for the other two. What is
 * left over goes to whatever else is in scope, and the videos ride on their own
 * allowance.
 */
export function orderReferences<T>(s: RefSlots<T>): T[] {
  const out: T[] = [];
  const [lead, ...moreCars] = s.car;
  if (lead) out.push(lead);
  if (s.emblem) out.push(s.emblem);
  if (s.seed) out.push(s.seed);
  // At most two: a part holds two or three scenes, and a reference set that is
  // mostly compositions stops being a record of what the car looks like.
  out.push(...(s.frames ?? []).slice(0, 2));
  const room = (): number => Math.max(0, s.max - out.length);

  out.push(...moreCars.slice(0, Math.max(0, s.max - out.length - 2)));
  if (s.actor && room() > 0) out.push(s.actor);
  if (s.place && room() > 0) out.push(s.place);
  if (!s.car.length && s.anchor && room() > 0) out.push(s.anchor);
  out.push(...s.rest.filter((r) => r !== s.place && r !== s.actor).slice(0, room()));
  out.push(...(s.videos ?? []).slice(0, s.maxVideos ?? 3));
  return out;
}

/** One reference, and whether it made the cut. */
export interface PlannedRef {
  photo: DealerPhoto;
  /** What the model is told this picture is — not what the library calls it. */
  label: string;
  role: RefRole;
  /** Its place in the reference list the model is given, or null when it did not fit. */
  slot: number | null;
  /** Held back by hand on this project. */
  held?: boolean;
}

export interface ReferencePlan {
  /** In the order the model sees them, numbered as the prompt's legend numbers them. */
  sent: PlannedRef[];
  /** In scope, but past the model's limit — nothing you can do but remove something else. */
  spare: PlannedRef[];
  /** Logos and the like: composited over the finished cut, never sent to the model. */
  overlays: PlannedRef[];
  max: number;
  maxVideos: number;
}

/**
 * What this brief sends, worked out from the same rule the renderer uses.
 *
 * The renderer picks the vehicle photographs a given part needs (a scene about the
 * cabin gets the cabin); here every vehicle photograph is offered in library order,
 * so the list is what part one sees. Which side is chosen changes per part, not
 * which photographs exist — so this is the right thing to check before paying.
 */
export function referencePlan(
  brief: Pick<Brief, 'attachments' | 'carModel' | 'vehicleKind'>,
  opts: { max?: number; maxVideos?: number; held?: string[] } = {},
): ReferencePlan {
  const max = Math.max(1, opts.max ?? 10);
  const maxVideos = Math.max(0, opts.maxVideos ?? 3);
  const held = new Set(opts.held ?? []);
  const all = (brief.attachments ?? []).map((photo) => ({
    photo,
    label: sentLabel(photo, { carModel: brief.carModel, vehicleKind: brief.vehicleKind }),
    role: refRole(photo),
    slot: null as number | null,
    held: held.has(photo.filename),
  }));

  const overlays = all.filter((r) => r.role === 'overlay');
  const live = all.filter((r) => r.role !== 'overlay' && !r.held);
  const car = live.filter((r) => r.role === 'vehicle');
  const emblem = live.find((r) => r.role === 'emblem');
  const actor = live.find((r) => r.role === 'presenter');
  const rest = live.filter((r) => r.role === 'dealership' || r.role === 'extra');
  const place = rest[0];
  const videos = live.filter((r) => r.role === 'video');

  const ordered = orderReferences({ car, emblem, actor, place, rest, videos, max, maxVideos });
  ordered.forEach((r, i) => {
    r.slot = i;
  });

  const sentSet = new Set(ordered);
  return {
    sent: ordered,
    spare: all.filter((r) => r.role !== 'overlay' && !sentSet.has(r)),
    overlays,
    max,
    maxVideos,
  };
}
