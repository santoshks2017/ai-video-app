/**
 * Glue between the library layer and the existing prompt/validation engine.
 *
 * A Project references a client / actor / car by id. `composeBrief` resolves
 * those into the flat `Brief` that buildPrompt, runChecks and estimateCost
 * already understand — so the whole generation pipeline stays unchanged.
 */

import { adaptTrial, clampPace } from './context.js';
import { suggestDuration } from './duration.js';
import type { Brief, DealerPhoto, CategoryId } from './types.js';
import type {
  VehicleKind,
  ActorProfile,
  CarModelProfile,
  ClientProfile,
  GlobalInstruction,
  Project,
  ProjectStage,
  ProjectVideoSpec,
  StoredImage,
  CarAngle,
  LanguageProfile,
} from './library.js';
import { CAR_VIEWS } from './library.js';
import { emptyBrief } from './defaults.js';

export function emptySpec(): ProjectVideoSpec {
  const b = emptyBrief();
  return {
    durationSec: b.durationSec,
    durationAuto: true,
    pace: 1,
    maxChunkSec: b.maxChunkSec,
    aspect: b.aspect,
    resolution: b.resolution,
    narration: b.narration,
    textLang: b.textLang,
    captionStyle: b.captionStyle,
    music: b.music,
    visualStyle: b.visualStyle,
    cta: b.cta,
    footer: b.footer,
    endCardOn: b.endCardOn,
    endCard: b.endCard,
  };
}

export function emptyProject(): Project {
  const now = Date.now();
  return {
    id: '',
    name: '',
    prompt: '',
    useCases: [],
    spec: emptySpec(),
    fieldValues: {},
    sceneEdits: {},
    extraRefs: [],
    status: 'draft',
    stage: 'open',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The board a designer works from, left to right.
 *
 * The wording is the team's, not the pipeline's: a film is open until someone
 * picks it up, in progress while it is being made, in review while someone else
 * is looking at it, and delivered once the client has it.
 */
export const PROJECT_STAGES: { id: ProjectStage; label: string; hint: string }[] = [
  { id: 'open', label: 'Open', hint: 'Briefed, not started' },
  { id: 'wip', label: 'In progress', hint: 'Being written or generated' },
  { id: 'review', label: 'In review', hint: 'Waiting on a look' },
  { id: 'delivered', label: 'Delivered', hint: 'Sent to the client' },
];

/**
 * Which column a project belongs in.
 *
 * Projects made before the board existed have no stage of their own, so one is
 * read from what has happened to them: a film that has been generated is waiting
 * on someone's eyes, a film mid-render is in progress, everything else is open.
 */
export function projectStage(
  p: Pick<Project, 'stage' | 'status' | 'generationCount'>,
): ProjectStage {
  if (p.stage) return p.stage;
  if (p.status === 'generating') return 'wip';
  if (p.status === 'generated' || (p.generationCount ?? 0) > 0) return 'review';
  return 'open';
}

/** The vehicles a project features, including the older single-car field. */
export function projectVehicleIds(project: Pick<Project, 'carId' | 'carIds'>): string[] {
  const ids = project.carIds?.length ? project.carIds : project.carId ? [project.carId] : [];
  return [...new Set(ids.filter(Boolean))];
}

export interface ComposeInputs {
  client?: ClientProfile | null;
  actor?: ActorProfile | null;
  /** The hero vehicle. */
  car?: CarModelProfile | null;
  /** Every vehicle the film features, hero first. */
  vehicles?: CarModelProfile[];
  instructions?: GlobalInstruction[];
  /** The project's chosen language — its rules travel with the brief. */
  language?: LanguageProfile | null;
  /**
   * The whole vehicle library. Only consulted when no model was picked, to name
   * the client brand's current range instead of leaving the choice open.
   */
  library?: CarModelProfile[];
}

const ANGLE_ORDER: CarAngle[] = ['front', 'side', 'rear', 'interior'];

function toDealerPhoto(img: StoredImage, kind: DealerPhoto['kind']): DealerPhoto {
  return {
    label: img.label,
    filename: img.filename,
    kind,
    refId: img.refId,
    storagePath: img.storagePath,
    src: img.url,
  };
}

/**
 * A colour as a person says it. CarDekho's file names carry a paint code —
 * "226_Stealth Black" — which is noise in a dropdown and in a prompt.
 */
export const colourName = (raw: string | undefined): string =>
  String(raw ?? '').replace(/^\s*\d+\s*[_\-\s]+/, '').trim();

/**
 * The hero car's reference set: the chosen colour's image, and the angle shots.
 *
 * The colour is looked up on the variant first, then on the model. Variants are
 * synced with an empty colour list while the picker lists the model's colours, so
 * looking only at the variant silently dropped the chosen paint whenever a variant
 * was also picked — and every reference sent was the launch colour. When a colour
 * with an image is chosen, only the first shot of each angle is kept: those photos
 * show whatever paint the source shot them in, and seven of them outvote one
 * colour image.
 */
export function carReferenceSet(
  car: CarModelProfile,
  variantName?: string,
  colour?: string,
): { swatch?: StoredImage; shots: StoredImage[] } {
  const variant = variantName ? car.variants.find((v) => v.name === variantName) : undefined;
  const picked = colour
    ? [...(variant?.colours ?? []), ...(car.colours ?? [])].find((c) => c.name === colour)
    : undefined;
  const shots: StoredImage[] = [];
  for (const angle of ANGLE_ORDER) {
    const fromVariant = variant?.images?.[angle] ?? [];
    const fromModel = car.images?.[angle] ?? [];
    const pick = fromVariant.length ? fromVariant : fromModel;
    shots.push(...(picked?.image ? pick.slice(0, 1) : pick));
  }
  return { swatch: picked?.image, shots };
}

/** Car reference images for the chosen variant + colour, the colour's image first. */
export function carReferenceImages(car: CarModelProfile, variantName?: string, colour?: string): StoredImage[] {
  const { swatch, shots } = carReferenceSet(car, variantName, colour);
  return swatch ? [swatch, ...shots] : shots;
}

/**
 * Does a client's brand refer to the same marque as a library record's?
 *
 * Client brands are typed by hand — "Suzuki", "RE", "Hero MotoCorp" — while the
 * library takes its brand from the source slug, so Maruti models arrive as
 * "Maruti". A plain equality check silently found no line-up and the film went
 * back to inventing a car, which is the bug this was meant to fix.
 */
export function brandMatches(a: string | undefined, b: string | undefined): boolean {
  const norm = (x: string): string => x.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const x = norm(a ?? '');
  const y = norm(b ?? '');
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;

  // Marques the trade calls by more than one name.
  const ALIASES: string[][] = [
    ['maruti', 'suzuki', 'maruti suzuki', 'nexa', 'arena'],
    ['hero', 'hero motocorp', 'hero honda'],
    ['royal enfield', 're', 'enfield'],
    ['mahindra', 'mahindra mahindra'],
    ['tvs', 'tvs motor'],
    ['bajaj', 'bajaj auto'],
    ['tata', 'tata motors'],
    ['hyundai', 'hyundai motor'],
    ['honda', 'honda motorcycle', 'hmsi'],
  ];
  return ALIASES.some((group) => group.includes(x) && group.includes(y));
}

export function composeBrief(project: Project, inputs: ComposeInputs = {}): Brief {
  const { client, actor, instructions, language } = inputs;
  // Hero first, then any others the dealer wants in the same film.
  const vehicles = (inputs.vehicles?.length ? inputs.vehicles : inputs.car ? [inputs.car] : []).filter(Boolean);
  const car = vehicles[0] ?? null;
  const b = emptyBrief();
  const s = project.spec;

  if (language) {
    b.language = {
      code: language.code,
      name: language.name,
      needsPhonetics: language.needsPhonetics,
      writtenGuide: language.writtenGuide,
    };
  }
  b.categories = project.useCases;
  b.narration = s.narration;
  b.durationSec = s.durationSec;
  b.maxChunkSec = s.maxChunkSec;
  b.aspect = s.aspect;
  b.resolution = s.resolution;
  b.music = s.music;
  b.textLang = s.textLang;
  b.captionStyle = s.captionStyle;
  b.visualStyle = s.visualStyle;
  b.cta = s.cta;
  // The footer strip is a client property; the project no longer sets it.
  b.footer = client?.footerText?.trim() ?? '';
  b.endCardOn = s.endCardOn;
  b.endCard = s.endCard;
  b.fieldValues = project.fieldValues;
  b.omitScenes = Object.entries(project.sceneEdits ?? {})
    .filter(([, e]) => e?.deleted)
    .map(([key]) => key);
  b.pace = clampPace(s.pace);

  if (client) {
    b.dealer = {
      id: client.id,
      dealerName: client.displayName?.trim() || client.name,
      brandModel: car ? `${car.brand} ${car.model}` : client.brand,
      phone: client.phone ?? '',
      tier: client.tier,
      address: [client.address, client.city].filter(Boolean).join(', '),
      city: client.city,
      fictionalize: client.fictionalize,
      fakeBrandModel: client.fakeBrandModel ?? '',
      fakeDealer: client.fakeDealer ?? '',
      photos: [],
    };
  }

  if (actor) {
    b.actor = {
      id: actor.id,
      name: actor.name,
      gender: actor.gender,
      age: actor.age ?? '',
      style: actor.style ?? '',
      voice: actor.voice ?? '',
      sourceNote: actor.sourceNote ?? '',
      photo: actor.photo?.url,
    };
  }

  if (car) {
    b.modelSpecific = true;
    b.carColour = colourName(project.carColour) || undefined;
    b.carModel = [car.brand, car.model, vehicles.length === 1 ? project.carVariant : ''].filter(Boolean).join(' ');
    if (vehicles.length > 1) {
      b.alsoFeatured = vehicles.slice(1).map((v) => `${v.brand} ${v.model}`);
    }
  } else if (client?.brand?.trim()) {
    // No model picked. Rather than leave the video model to invent one — which
    // is how an outdated generation ends up on screen — hand it the brand's
    // current range from the library and let it choose within that.
    // A dealer with several brands leads with the first.
    const brand = (client.brands?.find((b) => b.trim()) ?? client.brand).trim();
    const sells: VehicleKind = client.vehicleKind ?? 'car';
    const models = (inputs.library ?? [])
      .filter((c) => (c.kind ?? 'car') === sells && brandMatches(c.brand, brand))
      .map((c) => c.model.trim())
      .filter(Boolean)
      .sort((a, z) => a.localeCompare(z));
    if (models.length) b.lineup = { brand, kind: sells, models: [...new Set(models)] };
  }
  // Cars are driven and bikes are ridden — decided once, from what the film shows.
  b.vehicleKind = car?.kind ?? client?.vehicleKind ?? b.lineup?.kind ?? 'car';

  // The storyboard as the designer arranged it: their order, and any scene they
  // wrote themselves. Timing and the split into parts are worked out downstream,
  // so a scene moved into a full part pushes the rest along on its own.
  if (project.sceneOrder?.length) b.sceneOrder = project.sceneOrder;
  if (project.addedScenes?.length) b.addedScenes = project.addedScenes;

  // Reference images, most-specific first: car → client logo/photos → project extras.
  const attachments: DealerPhoto[] = [];
  // Photos attached to the project are the vehicle. They outrank the library, because
  // the library is what got it wrong.
  const attachedCar = (project.carRefs ?? []).filter((img) => img?.storagePath);
  if (attachedCar.length) {
    b.attachedCarPhotos = true;
    for (const img of attachedCar) {
      attachments.push({
        ...toDealerPhoto(img, 'car-model'),
        // The side it shows travels with it, so a scene about the cabin is matched
        // to the cabin photo rather than the model inventing one.
        angle: img.angle,
        label: `${img.label?.trim() || 'Attached photo'}${img.angle ? ` (${img.angle})` : ''} — the exact vehicle this film shows`,
      });
    }
  } else if (vehicles.length) {
    // The hero gets its variant and colour; the others contribute one shot each
    // so the model knows what they look like without swamping the reference set.
    const hero = carReferenceSet(car!, project.carVariant, project.carColour);
    const paint = colourName(project.carColour);
    if (hero.swatch) {
      attachments.push({
        ...toDealerPhoto(hero.swatch, 'car-model'),
        label: `Colour reference — ${paint}: paint the car exactly this colour`,
      });
    }
    /*
     * One sheet per view, when the vehicle has them.
     *
     * A sheet holds every photograph of that side of the car in a single image,
     * so the whole car reaches the model in five slots instead of one slot per
     * photograph — which is how three-quarters of what the source publishes used
     * to be left behind, and a side nobody showed it is a side it invents.
     */
    const sheets = car!.sheets ?? {};
    const sheeted = CAR_VIEWS.filter((v) => sheets[v]?.storagePath);
    if (sheeted.length) {
      for (const view of sheeted) {
        const img = sheets[view]!;
        attachments.push({
          ...toDealerPhoto(img, 'car-model'),
          angle: view === 'features' ? undefined : (view as CarAngle),
          label:
            view === 'features'
              ? `${car!.brand} ${car!.model} — its details, close up and named`
              : `${car!.brand} ${car!.model} — every photograph of the ${view}${
                  paint ? '; shape only, the paint may differ' : ''
                }`,
        });
      }
    } else {
      // Nothing has been gathered into sheets yet: the individual shots, as before.
      // Each keeps the part of the car it shows, so a scene about the cabin is
      // matched to a cabin photo — or flagged when there is none.
      const heroVariant = car!.variants.find((v) => v.name === project.carVariant);
      const angleOf = (img: StoredImage): CarAngle | undefined =>
        ANGLE_ORDER.find((a) =>
          [...(heroVariant?.images?.[a] ?? []), ...(car!.images?.[a] ?? [])].some(
            (x) => x.storagePath === img.storagePath,
          ),
        );
      for (const img of hero.shots) {
        const photo = { ...toDealerPhoto(img, 'car-model'), angle: angleOf(img) };
        // Said in the label because the label is what the prompt cites beside each
        // file: the model must take shape, not paint, from these.
        attachments.push(
          paint && hero.swatch ? { ...photo, label: `${photo.label} — shape reference; its paint may differ` } : photo,
        );
      }
    }
    for (const v of vehicles.slice(1)) {
      const first = carReferenceImages(v)[0];
      if (first) attachments.push(toDealerPhoto(first, 'car-model'));
    }
  } else if (b.lineup) {
    // One shot each from a few models in the range: enough to fix the brand's
    // current design language without pinning the film to a single car.
    const inRange = (inputs.library ?? []).filter(
      (c) => (c.kind ?? 'car') === b.lineup!.kind && brandMatches(c.brand, b.lineup!.brand),
    );
    for (const c of inRange.slice(0, 3)) {
      const first = carReferenceImages(c)[0];
      if (first) attachments.push(toDealerPhoto(first, 'car-model'));
    }
  }
  // The presenter's own photograph. Described in prose the look drifts — hair up
  // in one part, down in the next — and prose is all this used to be.
  if (actor?.photo?.storagePath) {
    attachments.push({
      ...toDealerPhoto(actor.photo, 'actor'),
      label: `${actor.name || 'The presenter'} — the person on camera`,
    });
  }
  if (client?.logo) attachments.push(toDealerPhoto(client.logo, 'logo'));
  if (client?.brandLogo) attachments.push(toDealerPhoto(client.brandLogo, 'brand-logo'));
  for (const img of client?.photos ?? []) attachments.push(toDealerPhoto(img, 'dealer'));
  for (const img of project.extraRefs) attachments.push(toDealerPhoto(img, 'dealer'));
  for (const vid of project.videoRefs ?? []) {
    if (vid?.storagePath) attachments.push({ ...toDealerPhoto(vid, 'reference-video'), label: vid.label });
  }
  b.attachments = attachments;

  // Global instructions + the project's own steer become extra prompt direction.
  const extra: string[] = [];
  for (const gi of (instructions ?? []).filter((i) => i.enabled).sort((a, x) => a.order - x.order)) {
    if (gi.body.trim()) extra.push(gi.body.trim());
  }
  if (project.prompt?.trim()) extra.push(project.prompt.trim());
  b.extraDirection = extra;

  // The length follows the story — sized from the use cases and what was filled
  // in — unless the designer set it by hand. This is the length that is generated,
  // at a natural read; the pace speeds the finished film up afterwards.
  b.durationSec = (s.durationAuto && suggestDuration(b)) || s.durationSec;

  return b;
}

/** Which use cases a project can pick without contradiction (all 9 today). */
export function projectUseCases(project: Project): CategoryId[] {
  return project.useCases;
}

/**
 * Copy for the post-production overlays. The footer bar and end card are
 * composited by the API, not generated, so this is the single place their text
 * is decided.
 */
export function overlayCopy(brief: Brief): { footerText: string; endCardLines: string[] } {
  const d = brief.dealer;
  const shown = d.fictionalize ? d.fakeDealer || d.dealerName : d.dealerName;

  // The footer is a single glanceable strip, so it gets the short form — name,
  // city, phone. A full postal address (what a Google Business import returns)
  // wraps to two dense lines and reads as noise. The end card carries the
  // address in full instead.
  const footerText =
    brief.footer.trim() ||
    defaultFooterText({ displayName: shown, city: d.city, address: d.address, phone: d.phone });

  const endCardLines = brief.endCard.trim()
    ? brief.endCard
        .split(/\r?\n|\s*\|\s*/)
        .map((x) => adaptTrial(x.trim(), brief.vehicleKind))
        .filter(Boolean)
    : [shown, adaptTrial(brief.cta, brief.vehicleKind), d.address, d.phone].map((x) => (x ?? '').trim()).filter(Boolean);

  return { footerText, endCardLines };
}


/**
 * Guess a short trading name from a full listing name.
 * "Tata Motors Cars Showroom - Jasper Cars Private Limited, Malviya Nagar"
 *   → "Jasper Cars"
 */
export function suggestDisplayName(fullName: string): string {
  const raw = (fullName ?? '').trim();
  if (!raw) return '';
  const words = (v: string): number => v.split(/\s+/).filter(Boolean).length;

  const strip = (v: string): string => {
    let out = v.split(',')[0]!.trim();
    out = out.replace(/\s+(private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?|llp|inc\.?)$/i, '').trim();
    // Trailing "Motors"/"Cars"/"Showroom" is only noise when a real name remains.
    const lean = out.replace(/\s+(showroom|dealership|dealer|motors|automobiles|cars)$/i, '').trim();
    if (words(lean) >= 2) out = lean;
    return out;
  };

  const parts = raw.split(/\s+[-–|]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const tail = strip(parts[parts.length - 1]!);
    // A one-word tail is almost always the locality, not the trading name.
    const pick = words(tail) > 1 ? tail : strip(parts[0]!);
    if (pick) return pick;
  }
  return strip(raw) || raw;
}

/** The short contact strip suggested for a client: name · city · phone. */
export function defaultFooterText(c: {
  displayName?: string;
  name?: string;
  city?: string;
  address?: string;
  phone?: string;
}): string {
  const shown = (c.displayName?.trim() || c.name?.trim()) ?? '';
  const place = c.city?.trim() || lastAddressPart(c.address);
  return [shown, place, c.phone?.trim()].filter(Boolean).join('  ·  ');
}

function lastAddressPart(address?: string): string {
  const parts = (address ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && !/^\d{5,6}$/.test(x) && !/^india$/i.test(x));
  return parts.length > 1 ? parts[parts.length - 1]! : (parts[0] ?? '');
}
