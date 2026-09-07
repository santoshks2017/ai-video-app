/**
 * Glue between the library layer and the existing prompt/validation engine.
 *
 * A Project references a client / actor / car by id. `composeBrief` resolves
 * those into the flat `Brief` that buildPrompt, runChecks and estimateCost
 * already understand — so the whole generation pipeline stays unchanged.
 */

import type { Brief, DealerPhoto, CategoryId } from './types.js';
import type {
  ActorProfile,
  CarModelProfile,
  ClientProfile,
  GlobalInstruction,
  Project,
  ProjectVideoSpec,
  StoredImage,
  CarAngle,
} from './library.js';
import { emptyBrief } from './defaults.js';

export function emptySpec(): ProjectVideoSpec {
  const b = emptyBrief();
  return {
    durationSec: b.durationSec,
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
    createdAt: now,
    updatedAt: now,
  };
}

export interface ComposeInputs {
  client?: ClientProfile | null;
  actor?: ActorProfile | null;
  car?: CarModelProfile | null;
  instructions?: GlobalInstruction[];
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

/** Car reference images for the chosen variant + colour, falling back to the model set. */
export function carReferenceImages(
  car: CarModelProfile,
  variantName?: string,
  colourName?: string,
): StoredImage[] {
  const variant = variantName ? car.variants.find((v) => v.name === variantName) : undefined;
  const out: StoredImage[] = [];

  for (const angle of ANGLE_ORDER) {
    const fromVariant = variant?.images?.[angle] ?? [];
    const fromModel = car.images?.[angle] ?? [];
    const pick = fromVariant.length ? fromVariant : fromModel;
    out.push(...pick);
  }

  // Put the chosen colour's swatch first — it's the strongest signal for paint.
  const colour =
    (colourName && (variant?.colours ?? car.colours).find((c) => c.name === colourName)) || undefined;
  if (colour?.image) out.unshift(colour.image);

  return out;
}

export function composeBrief(project: Project, inputs: ComposeInputs = {}): Brief {
  const { client, actor, car, instructions } = inputs;
  const b = emptyBrief();
  const s = project.spec;

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
  b.footer = s.footer;
  b.endCardOn = s.endCardOn;
  b.endCard = s.endCard;
  b.fieldValues = project.fieldValues;

  if (client) {
    b.dealer = {
      id: client.id,
      dealerName: client.name,
      brandModel: car ? `${car.brand} ${car.model}` : client.brand,
      phone: client.phone ?? '',
      tier: client.tier,
      address: [client.address, client.city].filter(Boolean).join(', '),
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
    b.carModel = [car.brand, car.model, project.carVariant].filter(Boolean).join(' ');
  }

  // Reference images, most-specific first: car → client logo/photos → project extras.
  const attachments: DealerPhoto[] = [];
  if (car) {
    for (const img of carReferenceImages(car, project.carVariant, project.carColour)) {
      attachments.push(toDealerPhoto(img, 'car-model'));
    }
  }
  if (client?.logo) attachments.push(toDealerPhoto(client.logo, 'logo'));
  if (client?.brandLogo) attachments.push(toDealerPhoto(client.brandLogo, 'brand-logo'));
  for (const img of client?.photos ?? []) attachments.push(toDealerPhoto(img, 'dealer'));
  for (const img of project.extraRefs) attachments.push(toDealerPhoto(img, 'dealer'));
  b.attachments = attachments;

  // Global instructions + the project's own steer become extra prompt direction.
  const extra: string[] = [];
  for (const gi of (instructions ?? []).filter((i) => i.enabled).sort((a, x) => a.order - x.order)) {
    if (gi.body.trim()) extra.push(gi.body.trim());
  }
  if (project.prompt?.trim()) extra.push(project.prompt.trim());
  b.extraDirection = extra;

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
  const footerText =
    brief.footer.trim() || [shown, d.address, d.phone].map((x) => (x ?? '').trim()).filter(Boolean).join('  |  ');

  const endCardLines = brief.endCard.trim()
    ? brief.endCard
        .split(/\r?\n|\s*\|\s*/)
        .map((x) => x.trim())
        .filter(Boolean)
    : [shown, brief.cta, d.address, d.phone].map((x) => (x ?? '').trim()).filter(Boolean);

  return { footerText, endCardLines };
}
