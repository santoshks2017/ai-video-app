import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CREATIVE_ENGINES,
  CREATIVE_ENGINE_BY_ID,
  CREATIVE_FORMATS,
  CREATIVE_FORMAT_BY_ID,
  CREATIVE_TEMPLATES,
  OVERLAY_THEMES,
  applyCopyToCreative,
  classifyCreative,
  creativeLook,
  creativeUid,
  designSkeleton,
  designWordsOf,
  designZonesOf,
  emptyCopy,
  factRows,
  formatInr,
  hasWordLayers,
  isLightColour,
  layoutCreative,
  layoutDesigned,
  PROOF_FORMAT,
  sameDesignWords,
  showIntake,
  swapPicture,
  wordsBand,
  logoLayout,
  occasionIn,
  pictureAspectsFor,
  tidyCopy,
  type AttachedPhoto,
  type CarAngle,
  type CarModelProfile,
  type ClientProfile,
  type CopyClient,
  type CreativeCopy,
  type CreativeDoc,
  type CreativeEngineId,
  type CreativeFormatId,
  type CreativeLogoArt,
  type DesignedCreative,
  type ImageCreative,
  type ImageProject,
  type ImageRole,
  type LayoutInput,
  type PanelStyle,
  type PictureAspect,
  type PictureMode,
  type ScenePicture,
  type StoredImage,
} from '@ava/shared';
import { api, imageTabId, useApp } from '../state/appStore.js';
import { isApiError, uploadRef } from '../lib/client.js';
import { refUrl } from '../lib/api.js';
import { drawCreativeDesign, drawCreativeScene, reviseCreativeDesign, understandBrief, writeCreativeCopy, type CopyRequest, type DesignRequest, type DesignResult } from '../lib/creatives.js';
import { Banner, Confirm, Field, ImageUpload, Lock, Section, useReadOnly } from '../components/ui.js';
import { CreativeCanvas } from '../components/creative/CreativeCanvas.js';
import { CreativeEditor, type EditorPicture } from '../components/creative/CreativeEditor.js';
import { ImageIntake } from './ImageIntake.js';
import { downloadBlob, exportCreative, fileNameOf } from '../components/creative/render.js';
import { zipFiles } from '../components/creative/zip.js';

const ANGLES: CarAngle[] = ['front', 'side', 'rear', 'interior'];
const ASPECT_TEXT_BAND: Record<PictureAspect, 'top' | 'left'> = { '1:1': 'top', '4:5': 'top', '9:16': 'top', '16:9': 'left', '5:4': 'top', '21:9': 'left' };
const ROLE_LABEL_SHORT: Record<ImageRole, string> = { vehicle: 'vehicle', creative: 'creative', moment: 'moment', logo: 'logo' };
const SOCIAL_FORMATS = CREATIVE_FORMATS.filter((f) => f.group === 'social');
const AD_FORMATS = CREATIVE_FORMATS.filter((f) => f.group === 'cardekho');
/** Whether Nano Banana 2 designs this size whole, words and all, rather than drawing its picture. */
const designsWhole = (format: CreativeFormatId): boolean => CREATIVE_FORMAT_BY_ID[format].design === 'whole';
/** A photograph of the vehicle: tagged so, or not tagged at all — an attachment is a vehicle photo until it is read as something else. */
const isVehiclePhoto = (ph: AttachedPhoto): boolean => (ph.role ?? 'vehicle') === 'vehicle';

/* ---- what the page needs from the client and the car ---- */

function copyClientOf(c: ClientProfile | undefined): CopyClient & { segment?: string; styleNote?: string } {
  if (!c) return { name: '' };
  // Who the words are for. The address and the phone are the dealer panel's, set by the app.
  return {
    name: c.displayName || c.name,
    kind: c.kind === 'oem' ? 'oem' : 'dealer',
    brand: c.brand,
    city: c.city,
    tagline: c.tagline,
    segment: c.segment,
    styleNote: c.styleNote,
  };
}

function panelOf(c: ClientProfile | undefined, style: PanelStyle): LayoutInput['panel'] {
  if (!c) return { style: 'none', name: '', details: [] };
  const name = c.displayName || c.name;
  if (c.kind === 'oem') return { style, name, details: [c.tagline, c.website].filter((x): x is string => Boolean(x?.trim())) };
  const where = c.address?.trim() || c.city?.trim() || '';
  if (style === 'compact') return { style, name, details: [c.phone, c.city || where].filter((x): x is string => Boolean(x?.trim())) };
  return { style, name, details: [where, [c.phone, c.website].filter(Boolean).join('  ·  ')].filter((x) => x.trim()) };
}

const art = (img: StoredImage | undefined, white?: StoredImage): CreativeLogoArt | undefined =>
  img?.storagePath
    ? { src: refUrl(img.storagePath), storagePath: img.storagePath, ...(white?.storagePath ? { white: { src: refUrl(white.storagePath), storagePath: white.storagePath } } : {}) }
    : undefined;

/** The car's library photos, angle by angle. */
function libraryPhotos(car: CarModelProfile | undefined): Array<{ angle: CarAngle; photo: StoredImage }> {
  if (!car) return [];
  return ANGLES.flatMap((angle) => (car.images?.[angle] ?? []).slice(0, 4).map((photo) => ({ angle, photo })));
}

/** Words for the picture before the copy is written, from the facts alone, so the creatives never stand empty. */
function draftCopy(p: ImageProject, client: ClientProfile | undefined, car: CarModelProfile | undefined): CreativeCopy {
  const e = p.engine?.primary ?? 'feature';
  const f = p.facts;
  const model = car ? car.model : '';
  const dealer = client ? client.displayName || client.name : 'us';
  const occasion = f.occasion || occasionIn(p.prompt) || '';
  const offers = factRows(f.offers);
  const c = emptyCopy();
  switch (e) {
    case 'festival':
      c.kicker = dealer;
      c.headline = occasion ? `Happy ${occasion}` : 'Festive greetings';
      c.sub = f.wish || (occasion ? `Wishing you and your family a joyous ${occasion}.` : 'Wishing you and your family joy on every road.');
      if (p.engine?.secondary === 'offer' && offers[0]) c.badge = offers[0];
      break;
    case 'offer':
      c.kicker = occasion ? `${occasion} offer` : 'Limited-period offer';
      c.headline = model ? `Drive home the ${model}` : p.prompt.slice(0, 60) || 'An offer worth driving for';
      c.badge = offers[0] ?? '';
      c.points = offers.slice(1);
      c.sub = [f.emi, f.validity ? `Valid till ${f.validity}` : ''].filter(Boolean).join(' · ');
      c.cta = 'Book a test drive';
      break;
    case 'delivery':
      c.kicker = 'Congratulations';
      c.headline = f.customerName || 'Our valued customer';
      c.sub = `${model ? `on your new ${model}. ` : ''}Welcome to the ${dealer} family!`;
      break;
    case 'feature':
      c.headline = model ? `Meet the ${model}` : p.prompt.slice(0, 60) || 'Made for every road';
      c.points = factRows(f.features);
      c.sub = f.forWhom ? `Made for ${f.forWhom.toLowerCase()}` : '';
      c.cta = 'Book a test drive';
      break;
    case 'ev':
      c.kicker = 'Electric';
      c.headline = model ? `The ${model}. Effortlessly electric.` : 'Electric, effortless';
      c.points = [f.range, f.charge].filter((x): x is string => Boolean(x?.trim()));
      c.cta = 'Book a test drive';
      break;
    case 'launch':
      c.kicker = f.phase || 'Coming soon';
      c.headline = f.hint || model || 'Something new is here';
      c.sub = f.date || '';
      c.cta = f.phase === 'Bookings open' ? 'Book now' : '';
      break;
    case 'testdrive':
      c.kicker = 'Test drive';
      c.headline = model ? `Feel the ${model}` : 'Feel it for yourself';
      c.sub = [f.where, f.when].filter(Boolean).join(' · ');
      c.cta = 'Book a test drive';
      break;
    case 'service':
      c.kicker = 'Service';
      c.headline = f.campaign || 'Care that keeps you going';
      c.points = factRows(f.includes);
      c.sub = f.validity ? `Valid till ${f.validity}` : '';
      c.cta = 'Book a service';
      break;
    case 'community':
      c.kicker = "You're invited";
      c.headline = f.event || 'Join us';
      c.sub = [f.date, f.time, f.venue].filter(Boolean).join(' · ');
      break;
    case 'testimonial':
      c.headline = f.quote ? `“${f.quote}”` : 'In their words';
      c.sub = f.customerName ? `— ${f.customerName}` : '';
      break;
    case 'achievement':
      c.kicker = 'Thank you';
      c.headline = f.milestone || 'A milestone, thanks to you';
      c.sub = f.detail || '';
      break;
    case 'accessories':
      c.kicker = 'Accessories';
      c.headline = f.package || 'Make it yours';
      c.points = factRows(f.items);
      c.badge = f.price || '';
      c.cta = 'Book an appointment';
      break;
  }
  return c;
}

/* ---- the page ---- */

export function ImageProjectEditor({ projectId }: { projectId: string }) {
  const stored = useApp((s) => s.imageProjects.find((p) => p.id === projectId));
  const clients = useApp((s) => s.clients);
  const cars = useApp((s) => s.cars);
  const languages = useApp((s) => s.languages);
  const refresh = useApp((s) => s.refresh);
  const go = useApp((s) => s.go);
  const closeTab = useApp((s) => s.closeTab);
  const isAdmin = useApp((s) => s.can('admin'));
  const canCreate = useApp((s) => s.can('creator'));
  const readOnly = useReadOnly();

  const [p, setP] = useState<ImageProject | null>(stored ?? null);
  const dirty = useRef(false);
  const removed = useRef(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<'' | 'copy' | 'scene' | 'design'>('');
  const [error, setError] = useState('');
  const [sceneState, setSceneState] = useState<Partial<Record<PictureAspect, 'working' | 'failed'>>>({});
  /** Sizes Nano Banana 2 is designing or changing now, or failed on. */
  const [designState, setDesignState] = useState<Partial<Record<CreativeFormatId, 'working' | 'failed'>>>({});
  /** A change being asked for, size by size. */
  const [changes, setChanges] = useState<Partial<Record<CreativeFormatId, string>>>({});
  /** The size open in the editor, with the document as it was when it opened. */
  const [editing, setEditing] = useState<{ format: CreativeFormatId; doc: CreativeDoc } | null>(null);
  const [downloading, setDownloading] = useState(false);
  /** Whether the one-shot understand call is in flight. */
  const [understanding, setUnderstanding] = useState(false);
  /** 'auto' shows the intake or the workspace, whichever the project calls for; 'work' pins the workspace. */
  const [view, setView] = useState<'auto' | 'work'>('auto');

  // The record as stored arrives after the list loads; later, the server's totals come with it.
  useEffect(() => {
    if (!stored) return;
    if (!p || !dirty.current) setP(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  // Saved a moment after edits settle, like a video project.
  useEffect(() => {
    if (!p || !dirty.current || removed.current) return;
    const t = setTimeout(async () => {
      if (removed.current) return;
      const r = await api.imageProjects.save(p);
      dirty.current = false;
      if (!isApiError(r)) {
        setSavedAt(Date.now());
        await refresh();
      } else setError(r.message);
    }, 900);
    return () => clearTimeout(t);
  }, [p, refresh]);

  const set = (patch: Partial<ImageProject> | ((cur: ImageProject) => Partial<ImageProject>)): void => {
    if (readOnly) return;
    dirty.current = true;
    setP((cur) => (cur ? { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch), updatedAt: Date.now() } : cur));
  };

  const client = clients.find((c) => c.id === p?.clientId);
  const brands = useMemo(() => (client ? [client.brand, ...(client.brands ?? [])].filter(Boolean).map((b) => b.toLowerCase()) : []), [client]);
  const vehicleChoices = useMemo(
    () =>
      cars
        .filter((c) => !client?.vehicleKind || (c.kind ?? 'car') === client.vehicleKind)
        .filter((c) => !brands.length || brands.some((b) => c.brand.toLowerCase().includes(b) || b.includes(c.brand.toLowerCase())))
        .sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`)),
    [cars, client, brands],
  );
  const car = cars.find((c) => c.id === p?.carId);
  const photos = useMemo(() => libraryPhotos(car), [car]);

  const engineId: CreativeEngineId = p?.engine?.primary ?? 'feature';
  const engine = CREATIVE_ENGINE_BY_ID[engineId];
  const second = p?.engine?.secondary ? CREATIVE_ENGINE_BY_ID[p.engine.secondary] : undefined;
  const occasion = p ? p.facts.occasion || occasionIn(p.prompt) || undefined : undefined;

  const languageChoices = useMemo(
    () => [
      { id: 'en', name: 'English', script: 'latin' as const },
      { id: 'hinglish', name: 'Hinglish', script: 'latin' as const },
      ...languages.filter((l) => l.enabled && l.code !== 'en').map((l) => ({ id: l.code, name: l.name, script: 'indic' as const, guide: l.writtenGuide })),
    ],
    [languages],
  );
  const language = languageChoices.find((l) => l.id === (p?.languageId ?? 'en')) ?? languageChoices[0]!;

  const look = useMemo(() => creativeLook(p?.look, { brand: client?.brand, occasion }), [p?.look, client?.brand, occasion]);
  const copy = useMemo(() => {
    if (!p) return emptyCopy();
    if (p.copy) return p.copy;
    return tidyCopy(draftCopy(p, client, car), { validity: p.facts.validity, native: language.script === 'indic' });
  }, [p, client, car, language.script]);

  /**
   * The picture a size is built on: what Nano Banana 2 designed for it, its scene, the photo as
   * it is, or the upload. A size not designed yet shows a draft laid out on the photo.
   */
  const pictureFor = (format: CreativeFormatId): LayoutInput['picture'] => {
    if (!p) return undefined;
    const design = p.designs?.[format];
    if (p.pictureMode === 'design' && design && designsWhole(format)) return { src: refUrl(design.image.storagePath), storagePath: design.image.storagePath, mode: 'design' };
    const aspect = CREATIVE_FORMAT_BY_ID[format].pictureAspect;
    const drawn = p.pictures?.[aspect];
    // A strip wider than Nano Banana 2 draws: its picture, with the words laid on it.
    if (p.pictureMode === 'design' && !designsWhole(format) && drawn) return { src: refUrl(drawn.image.storagePath), storagePath: drawn.image.storagePath, mode: 'scene' };
    const scene = p.pictures?.[aspect];
    if (p.pictureMode === 'scene' && scene) return { src: refUrl(scene.image.storagePath), storagePath: scene.image.storagePath, mode: 'scene' };
    if (p.pictureMode === 'upload' && p.upload) return { src: refUrl(p.upload.storagePath), storagePath: p.upload.storagePath, mode: 'upload' };
    if (p.heroPhoto) return { src: refUrl(p.heroPhoto.storagePath), storagePath: p.heroPhoto.storagePath, mode: 'photo' };
    return undefined;
  };

  const inputFor = (format: CreativeFormatId, c: CreativeCopy = copy): LayoutInput => ({
    format,
    template: p?.templateId ?? engine.template,
    copy: c,
    look,
    picture: pictureFor(format),
    logos: { dealer: art(client?.logo, client?.logoWhite), brand: art(client?.brandLogo, client?.brandLogoWhite), placement: logoLayout(client?.logoPlacement) },
    panel: panelOf(client, p?.panelStyle ?? 'full'),
    script: language.script,
  });
  const autoDoc = (format: CreativeFormatId): CreativeDoc => {
    const input = inputFor(format);
    return input.picture?.mode === 'design' ? layoutDesigned(input) : layoutCreative(input);
  };

  const creatives = useMemo(
    () =>
      (p?.formats ?? []).map((format) => {
        const kept = p?.creatives.find((c) => c.format === format);
        return { format, kept, doc: kept ? kept.doc : autoDoc(format) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p, copy, look, client, language.script, engine.template],
  );

  if (!p) {
    return (
      <div className="editor-page">
        <div className="card">
          <div className="body">
            <div className="empty">{stored === undefined ? 'Loading this creative…' : 'This image project is gone.'}</div>
          </div>
        </div>
      </div>
    );
  }

  const madeFor = (f: CreativeFormatId): boolean => (designsWhole(f) ? Boolean(p.designs?.[f]) : Boolean(p.pictures?.[CREATIVE_FORMAT_BY_ID[f].pictureAspect]));
  const missingDesigns = p.formats.filter((f) => !madeFor(f));
  /** True once the only design made is the proof itself — the fan-out still belongs on the intake. */
  const proofOnly = Object.keys(p.designs ?? {}).every((f) => f === PROOF_FORMAT) && !p.creatives.length && !Object.keys(p.pictures ?? {}).length;
  /**
   * The intake is for a project with nothing made, or one the intake itself proved that still has
   * sizes to make. A project from before the intake whose one design is the square, or one whose
   * only size is the square, opens on the workspace.
   */
  const intakeFits = showIntake(p) || (Boolean(p.intake) && proofOnly && missingDesigns.length > 0);
  const intakeOpen = view === 'auto' && intakeFits;

  /* ---- actions ---- */

  /** One cheap call reads the brief and the images; its answer fills only what a human has not. */
  const understand = async (): Promise<void> => {
    setUnderstanding(true);
    setError('');
    const imgs = (p.attachedPhotos ?? []).slice(0, 4).map((x) => ({ storagePath: x.storagePath, ...(x.label ? { label: x.label } : {}) }));
    const r = await understandBrief(p.id, {
      brief: p.prompt,
      ...(client ? { client: { name: client.displayName || client.name, ...(client.brand ? { brand: client.brand } : {}) } } : {}),
      vehicles: vehicleChoices.map((c) => ({ id: c.id, name: `${c.brand} ${c.model}` })),
      languages: languageChoices.map((l) => ({ id: l.id, name: l.name })),
      images: imgs.map((x) => ({ ...(x.label ? { label: x.label } : {}) })),
    }, imgs);
    setUnderstanding(false);
    if (isApiError(r)) {
      // The model could not be reached: the keyword classifier stands in, marked so.
      const read = classifyCreative(p.prompt);
      const found = occasionIn(p.prompt);
      set((cur) => ({
        ...(read && !cur.engine?.manual
          ? { engine: { primary: read.primary, secondary: read.secondary, ratio: read.ratio } }
          // An unmatched brief reads as nothing: still give it a lead, so the proof is never blocked on an engine that was never set.
          : !read && !cur.engine
            ? { engine: { primary: 'feature' } }
            : {}),
        ...(found && !cur.facts.occasion ? { facts: { ...cur.facts, occasion: found } } : {}),
        intake: { at: Date.now(), heard: read?.heard ?? [], confidence: 'low', fallback: true },
      }));
      setError(r.message);
      return;
    }
    const it = r.interpretation;
    set((cur) => {
      const facts = { ...cur.facts };
      for (const [k, v] of Object.entries(it.facts)) if (!(facts[k] ?? '').trim()) facts[k] = v; // never over a human
      const attached = (cur.attachedPhotos ?? []).map((ph, i) => {
        const role = it.images.find((im) => im.index === i)?.role;
        return role ? { ...ph, role } : ph;
      });
      const creativeRef = attached.find((ph) => ph.role === 'creative');
      // The hero is only ever a photograph of the vehicle. One now read as a creative, a moment or a
      // logo gives way to the first vehicle photo; with none, the library's photo of the car the
      // project ends up with (the designer's own pick before the model's match); else no hero.
      const heroNow = cur.heroPhoto ? attached.find((ph) => ph.storagePath === cur.heroPhoto!.storagePath) : undefined;
      const keptHero = cur.heroPhoto && (!heroNow || isVehiclePhoto(heroNow)) ? cur.heroPhoto : undefined;
      const projectCar = cur.carId ?? it.carId;
      const libraryFirst = projectCar ? libraryPhotos(cars.find((c) => c.id === projectCar))[0] : undefined;
      const hero = keptHero ?? attached.find(isVehiclePhoto) ?? (libraryFirst ? { ...libraryFirst.photo, angle: libraryFirst.angle } : undefined);
      // The same creative, read again: keep what a human already chose for it rather than the model's fresh guess.
      const priorRef = creativeRef && cur.reference?.image.storagePath === creativeRef.storagePath ? cur.reference : undefined;
      return {
        ...(cur.engine?.manual ? {} : { engine: { primary: it.engine.primary, secondary: it.engine.secondary, ratio: it.engine.ratio } }),
        facts: it.occasion && !(facts.occasion ?? '').trim() ? { ...facts, occasion: it.occasion } : facts,
        ...(it.carId && !cur.carId ? { carId: it.carId } : {}),
        ...(it.colour && !cur.carColour ? { carColour: it.colour } : {}),
        ...(it.languageId && !cur.languageId ? { languageId: it.languageId } : {}),
        ...(it.sizes?.length ? { formats: CREATIVE_FORMATS.map((f) => f.id).filter((id) => it.sizes!.includes(id)) } : {}),
        ...(it.sceneNote && !cur.sceneNote ? { sceneNote: it.sceneNote } : {}),
        ...(it.copy && !cur.copy ? { copy: it.copy } : {}),
        attachedPhotos: attached,
        heroPhoto: hero,
        // A dropped reference is cleared, not left stale — but a kept one keeps the human's own intent and changes.
        reference: creativeRef
          ? { image: creativeRef, intent: priorRef?.intent ?? it.referenceIntent ?? 'recreate', changes: priorRef ? priorRef.changes : it.changes }
          : undefined,
        intake: { at: Date.now(), heard: it.heard, confidence: it.confidence, model: r.model },
      };
    });
  };

  const setPrompt = (prompt: string): void => {
    set((cur) => {
      const next: Partial<ImageProject> = { prompt };
      if (!cur.engine?.manual) {
        const read = classifyCreative(prompt);
        if (read) next.engine = { primary: read.primary, secondary: read.secondary, ratio: read.ratio };
      }
      // A festival brief names its occasion; pick it up unless one was chosen.
      const found = occasionIn(prompt);
      if (found && !cur.facts.occasion) next.facts = { ...cur.facts, occasion: found };
      return next;
    });
  };
  const setFact = (id: string, value: string): void => set((cur) => ({ facts: { ...cur.facts, [id]: value } }));
  /**
   * The vehicle picked on the intake. An attached photograph of the vehicle stays the hero; any
   * other hero — a library photo of the car it was, or none — becomes the new car's first library
   * photo, as the workspace's own pick does, so the picture is never built on the wrong car.
   */
  const pickVehicle = (carId: string | undefined): void =>
    set((cur) => {
      const tagged = cur.heroPhoto ? (cur.attachedPhotos ?? []).find((x) => x.storagePath === cur.heroPhoto!.storagePath) : undefined;
      if (tagged && isVehiclePhoto(tagged)) return { carId, carColour: undefined };
      const first = libraryPhotos(cars.find((c) => c.id === carId))[0];
      return { carId, carColour: undefined, heroPhoto: first ? { ...first.photo, angle: first.angle } : undefined };
    });
  const setCopy = (patch: Partial<CreativeCopy>): void =>
    set((cur) => {
      const next = { ...(cur.copy ?? copy), ...patch };
      // Words changed here reach the sizes someone already edited, without undoing their changes.
      return { copy: next, creatives: cur.creatives.map((c) => ({ ...c, doc: applyCopyToCreative(c.doc, next) })) };
    });

  const writeCopy = async (): Promise<CreativeCopy | null> => {
    if (!client) {
      setError('Pick the client first — the copy is written in their name.');
      return null;
    }
    setBusy('copy');
    setError('');
    const fields = [...engine.fields, ...(second?.fields ?? [])];
    const request: CopyRequest = {
      engine: { primary: engineId, secondary: p.engine?.secondary, ratio: p.engine?.ratio },
      prompt: p.prompt,
      facts: fields.map((f) => ({ label: f.label, value: p.facts[f.id] ?? '' })),
      client: copyClientOf(client),
      vehicle: car ? { model: car.model, brand: car.brand, colour: p.carColour, highlights: car.highlights?.slice(0, 8) } : undefined,
      language: { name: language.name, script: language.script, hinglish: language.id === 'hinglish', guide: 'guide' in language ? language.guide : undefined },
      voiceNote: p.voiceNote,
      occasion,
      validity: p.facts.validity,
    };
    const r = await writeCreativeCopy(p.id, request);
    setBusy('');
    if (isApiError(r)) {
      setError(r.message);
      return null;
    }
    setCopy(r.copy);
    return r.copy;
  };

  /** How far down the words reach on the size a picture is made for, so the picture leaves them room. */
  const bandFor = (aspect: PictureAspect): number | undefined => {
    const shown = creatives.find((c) => CREATIVE_FORMAT_BY_ID[c.format].pictureAspect === aspect);
    return shown ? wordsBand(shown.doc) : undefined;
  };

  /**
   * What the model calls the vehicle: the library's name for it, or — for a photo attached
   * without one — the vehicle in that photograph, by the client's make where it is known.
   */
  const vehicleName = car ? `${car.brand} ${car.model}` : `${client?.brand ? `${client.brand} ` : ''}vehicle in the photograph`;
  const vehicleKind: 'car' | 'bike' = (car?.kind ?? client?.vehicleKind) === 'bike' ? 'bike' : 'car';

  /** The vehicle's photographs for the model: the chosen one first, then its other sides. */
  const carRefList = (): Array<{ storagePath: string; label: string }> => {
    if (!p.heroPhoto) return [];
    const hero = p.heroPhoto;
    // Only photographs of the vehicle are car references — never an old creative, a moment or a
    // logo, not even one left as the hero from before it was read.
    const attachable = (p.attachedPhotos ?? []).filter(isVehiclePhoto);
    const tagged = (p.attachedPhotos ?? []).find((x) => x.storagePath === hero.storagePath);
    const heroIsVehicle = !tagged || isVehiclePhoto(tagged);
    if (!car) {
      // Attached photos only: the chosen one, then the others attached with it.
      return [...(heroIsVehicle ? [hero] : []), ...attachable.filter((x) => x.storagePath !== hero.storagePath)]
        .slice(0, 4)
        .map((x, i) => ({ storagePath: x.storagePath, label: i === 0 ? `the ${vehicleName}` : `the ${vehicleName}, another photograph` }));
    }
    const others = photos.filter((x) => x.photo.storagePath !== hero.storagePath);
    return [
      ...(heroIsVehicle ? [{ storagePath: hero.storagePath, label: `the ${car.brand} ${car.model}${hero.angle ? `, ${hero.angle}` : ''}` }] : []),
      // The vehicle's other sides; the cabin only when the picture is of the cabin.
      ...ANGLES.filter((a) => a !== 'interior' || hero.angle === 'interior')
        .map((a) => others.find((x) => x.angle === a && a !== hero.angle))
        .filter((x): x is { angle: CarAngle; photo: StoredImage } => Boolean(x))
        .slice(0, 3)
        .map((x) => ({ storagePath: x.photo.storagePath, label: `the ${car.brand} ${car.model}, ${x.angle}` })),
    ];
  };

  /** The image a design builds from: the uploaded original as master (other sizes), the proof as master (fan-out), an old creative as style, or a moment photo as the base. */
  const designReference = (purpose: 'proof' | 'fanout'): DesignRequest['reference'] | undefined => {
    if (p.reference?.intent === 'sizes') return { storagePath: p.reference.image.storagePath, kind: 'master' };
    if (purpose === 'fanout') {
      const proof = p.designs?.[PROOF_FORMAT];
      if (proof) return { storagePath: proof.image.storagePath, kind: 'master' };
    }
    if (p.reference) return { storagePath: p.reference.image.storagePath, kind: 'style', ...(p.reference.changes ? { changes: p.reference.changes } : {}) };
    const moment = (p.attachedPhotos ?? []).find((a) => a.role === 'moment');
    if (moment) return { storagePath: moment.storagePath, kind: 'base-photo' };
    return undefined;
  };

  /** What Nano Banana 2 is asked to design for one size: the words, the look, and where the app's logos and panel go. */
  const designBrief = (format: CreativeFormatId, c: CreativeCopy = copy): DesignRequest => {
    const input = inputFor(format, c);
    // Where the strip and the logos go is the layout's own, words and all.
    const zones = designZonesOf(layoutCreative({ ...input, picture: { src: '', mode: 'scene' } }), isLightColour(look.panel) ? 'light' : 'dark');
    return {
      format,
      engine: engineId,
      ...(p.engine?.secondary ? { secondary: p.engine.secondary } : {}),
      ...(p.templateId ? { template: p.templateId } : {}),
      ...(occasion ? { occasion } : {}),
      vehicle: { name: vehicleName, ...(p.carColour ? { colour: p.carColour } : {}), kind: vehicleKind },
      ...(p.sceneNote?.trim() ? { note: p.sceneNote.trim() } : {}),
      words: designWordsOf(c, input),
      language: { name: language.name, script: language.script },
      look: { panel: look.panel, accent: look.accent },
      zones,
    };
  };

  /**
   * The canvas Nano Banana 2 designs a size on — its shape in grey, with the client's logos in
   * their places — drawn here and stored, so the server can hand it over and check it after.
   */
  const uploadCanvas = async (format: CreativeFormatId): Promise<{ image: StoredImage; logos: number } | null> => {
    const doc = designSkeleton(inputFor(format));
    if (!doc.layers.length) return null;
    try {
      const blob = await exportCreative(doc, 'image/png');
      const up = await uploadRef(new File([blob], `canvas-${format}.png`, { type: 'image/png' }), `${p.name} · canvas · ${CREATIVE_FORMAT_BY_ID[format].label}`, 'extra');
      if (isApiError(up)) return null;
      return { image: { refId: up.refId, storagePath: up.storagePath, filename: up.filename, label: up.label }, logos: doc.layers.length };
    } catch {
      return null;
    }
  };

  /**
   * A new design for a size someone already changed: their changes stay, on the new picture.
   * A draft they changed before there was any design had its words as layers, which the design
   * now carries itself — that one is laid out afresh. Either way it is approved again.
   */
  const adoptDesign = (cur: ImageProject, format: CreativeFormatId, d: DesignedCreative): Partial<ImageProject> => {
    const kept = cur.creatives.find((c) => c.format === format);
    const creatives = !kept
      ? cur.creatives
      : hasWordLayers(kept.doc)
        ? cur.creatives.filter((c) => c.format !== format)
        : cur.creatives.map((c) =>
            c.format === format ? { ...c, doc: swapPicture(c.doc, { src: refUrl(d.image.storagePath), storagePath: d.image.storagePath }), approved: false, png: undefined, updatedAt: Date.now() } : c,
          );
    return { designs: { ...(cur.designs ?? {}), [format]: d }, pictureMode: 'design', creatives };
  };

  const designed = (r: DesignResult, skeleton: StoredImage | undefined, revision?: string): DesignedCreative => ({
    image: r.image,
    words: r.words,
    checks: r.checks,
    model: r.model,
    ...(r.width ? { width: r.width, height: r.height } : {}),
    ...(skeleton ? { skeleton } : {}),
    ...(revision ? { revision } : {}),
    at: Date.now(),
  });
  const settle = (format: CreativeFormatId, failed: boolean) =>
    setDesignState((s) => {
      const next = { ...s };
      if (failed) next[format] = 'failed';
      else delete next[format];
      return next;
    });

  /**
   * Nano Banana 2 makes the creatives — the sizes asked for, or every size. Most it designs
   * whole; a strip wider than it draws gets its picture, one for all the strips of a shape.
   */
  const makeDesigns = async (only?: CreativeFormatId[], opts?: { copy?: CreativeCopy; purpose?: 'proof' | 'fanout' }): Promise<void> => {
    const c = opts?.copy ?? copy;
    // Only the fan-out matches the square: a size made again in the workspace is designed afresh, not copied from it.
    const reference = designReference(opts?.purpose ?? 'proof');
    const refs = carRefList();
    if (!refs.length && !reference) return setError('Pick the vehicle and its photo, or attach a photo of it, first.');
    const formats = only ?? p.formats;
    if (!formats.length) return;
    setBusy('design');
    setError('');
    const whole = formats.filter(designsWhole);
    const strips = formats.filter((f) => !designsWhole(f));
    const stripAspects = pictureAspectsFor(strips);
    setDesignState((s) => ({ ...s, ...Object.fromEntries(formats.map((f) => [f, 'working'])) }));
    await Promise.all([
      ...whole.map(async (format) => {
        const canvas = await uploadCanvas(format);
        const brief = { ...designBrief(format, c), ...(canvas ? { canvas: { storagePath: canvas.image.storagePath, logos: canvas.logos } } : {}), ...(reference ? { reference } : {}) };
        const r = await drawCreativeDesign(p.id, brief, refs);
        if (isApiError(r)) {
          settle(format, true);
          setError(r.message);
          return;
        }
        settle(format, false);
        set((cur) => adoptDesign(cur, format, designed(r, canvas?.image)));
      }),
      ...stripAspects.map(async (aspect) => {
        const mine = strips.filter((f) => CREATIVE_FORMAT_BY_ID[f].pictureAspect === aspect);
        const r = await drawCreativeScene(
          p.id,
          {
            aspect,
            engine: engineId,
            ...(occasion ? { occasion } : {}),
            vehicle: { name: vehicleName, colour: p.carColour, kind: vehicleKind },
            note: p.sceneNote,
            textBand: ASPECT_TEXT_BAND[aspect],
            panel: false,
            mood: { panel: look.panel, accent: look.accent },
          },
          refs,
          reference?.kind === 'master' ? { storagePath: reference.storagePath } : undefined,
        );
        for (const f of mine) settle(f, isApiError(r));
        if (isApiError(r)) return setError(r.message);
        const pic: ScenePicture = { image: r.image, check: r.check, model: r.model, at: Date.now() };
        // Sizes someone changed keep their changes on the new picture.
        set((cur) => ({
          pictures: { ...(cur.pictures ?? {}), [aspect]: pic },
          creatives: cur.creatives.map((c) =>
            mine.includes(c.format) ? { ...c, doc: swapPicture(c.doc, { src: refUrl(r.image.storagePath), storagePath: r.image.storagePath }), approved: false, png: undefined, updatedAt: Date.now() } : c,
          ),
        }));
      }),
    ]);
    setBusy('');
    await refresh();
  };

  /** The proof: the words written if they have not been, then the square designed with the reference. */
  const makeProof = async (): Promise<void> => {
    let c: CreativeCopy | null = p.copy ?? null;
    if (!c) c = await writeCopy();
    if (!c) return; // writeCopy set the error
    await makeDesigns([PROOF_FORMAT], { copy: c, purpose: 'proof' });
  };

  /** Every chosen size not made yet, in the proof's image. */
  const makeAllSizes = async (): Promise<void> => {
    const todo = p.formats.filter((f) => !madeFor(f));
    if (todo.length) await makeDesigns(todo, { purpose: 'fanout' });
  };

  /** One change to a size Nano Banana 2 designed, everything else kept. */
  const reviseDesign = async (format: CreativeFormatId, changeText?: string): Promise<void> => {
    const d = p.designs?.[format];
    const change = (changeText ?? changes[format])?.trim();
    if (!d || !change) return;
    setDesignState((s) => ({ ...s, [format]: 'working' }));
    setError('');
    // Checked against the words it carries, so a change of colour is not taken for a change of words.
    const logos = designSkeleton(inputFor(format)).layers.length;
    const brief = { ...designBrief(format), words: d.words, ...(d.skeleton ? { canvas: { storagePath: d.skeleton.storagePath, logos } } : {}) };
    const r = await reviseCreativeDesign(p.id, brief, { storagePath: d.image.storagePath }, change, carRefList().slice(0, 3));
    if (isApiError(r)) {
      settle(format, true);
      setError(r.message);
      return;
    }
    settle(format, false);
    setChanges((c) => ({ ...c, [format]: '' }));
    set((cur) => adoptDesign(cur, format, designed(r, d.skeleton, change)));
    await refresh();
  };

  /** Pictures for the sizes' shapes: the ones asked for, or every shape the sizes need. */
  const makePictures = async (only?: PictureAspect[]): Promise<void> => {
    if (!p.heroPhoto) return setError('Pick the vehicle and its photo, or attach a photo of it, first.');
    const aspects = only ?? pictureAspectsFor(p.formats);
    if (!aspects.length) return;
    setBusy('scene');
    setError('');
    const refs = carRefList();
    setSceneState(Object.fromEntries(aspects.map((a) => [a, 'working'])));
    await Promise.all(
      aspects.map(async (aspect) => {
        const r = await drawCreativeScene(
          p.id,
          {
            aspect,
            engine: engineId,
            occasion,
            vehicle: { name: vehicleName, colour: p.carColour, kind: vehicleKind },
            note: p.sceneNote,
            textBand: ASPECT_TEXT_BAND[aspect],
            ...(ASPECT_TEXT_BAND[aspect] === 'top' ? { band: bandFor(aspect) } : {}),
            panel: p.panelStyle !== 'none',
            mood: { panel: look.panel, accent: look.accent },
          },
          refs,
        );
        if (isApiError(r)) {
          setSceneState((s) => ({ ...s, [aspect]: 'failed' }));
          setError(r.message);
          return;
        }
        const pic: ScenePicture = { image: r.image, check: r.check, model: r.model, at: Date.now() };
        setSceneState((s) => {
          const next = { ...s };
          delete next[aspect];
          return next;
        });
        set((cur) => ({ pictures: { ...(cur.pictures ?? {}), [aspect]: pic }, pictureMode: 'scene' }));
      }),
    );
    setBusy('');
    await refresh();
  };

  const saveCreative = async (format: CreativeFormatId, doc: CreativeDoc, approved?: boolean): Promise<void> => {
    const bad = validateCreative(doc);
    if (bad) throw new Error(bad);
    let png: StoredImage | undefined;
    try {
      const blob = await exportCreative(doc, 'image/png');
      const file = new File([blob], fileNameOf(sizeName(format), 'png'), { type: 'image/png' });
      const up = await uploadRef(file, `${p.name} · ${CREATIVE_FORMAT_BY_ID[format].label}`, 'extra');
      if (!isApiError(up)) png = { refId: up.refId, storagePath: up.storagePath, filename: up.filename, label: up.label };
    } catch {
      /* the document is still kept; the picture is made again on the next save */
    }
    set((cur) => {
      const prior = cur.creatives.find((c) => c.format === format);
      const entry: ImageCreative = { id: prior?.id ?? creativeUid(), format, doc, approved: approved ?? prior?.approved, png: png ?? prior?.png, updatedAt: Date.now() };
      return { creatives: [...cur.creatives.filter((c) => c.format !== format), entry] };
    });
  };
  const validateCreative = (doc: CreativeDoc): string | null => (doc.layers.length ? null : 'This creative has nothing on it.');

  const approve = async (format: CreativeFormatId, doc: CreativeDoc, on: boolean): Promise<void> => {
    if (on) await saveCreative(format, doc, true);
    else set((cur) => ({ creatives: cur.creatives.map((c) => (c.format === format ? { ...c, approved: false } : c)) }));
  };
  const resetCreative = (format: CreativeFormatId): void => set((cur) => ({ creatives: cur.creatives.filter((c) => c.format !== format) }));

  const download = async (doc: CreativeDoc, format: CreativeFormatId, type: 'image/png' | 'image/jpeg'): Promise<void> => {
    try {
      const blob = await exportCreative(doc, type);
      downloadBlob(blob, fileNameOf(sizeName(format), type === 'image/png' ? 'png' : 'jpg'));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /** A file's name: the project, the size's name and its pixels — the pixels are how an ad slot is matched. */
  const sizeName = (format: CreativeFormatId): string => {
    const f = CREATIVE_FORMAT_BY_ID[format];
    return `${p.name}-${f.label}-${f.width}x${f.height}`;
  };

  const downloadAll = async (): Promise<void> => {
    setDownloading(true);
    try {
      const files = await Promise.all(
        creatives.map(async (c) => ({ name: fileNameOf(sizeName(c.format), 'png'), blob: await exportCreative(c.doc, 'image/png') })),
      );
      downloadBlob(await zipFiles(files), fileNameOf(p.name || 'creatives', 'zip'));
    } catch (e) {
      setError((e as Error).message);
    }
    setDownloading(false);
  };
  /* ---- the editor ---- */

  const editorLibrary: EditorPicture[] = [
    ...Object.entries(p.designs ?? {}).map(([f, d]) => ({ label: `Nano Banana 2 · ${CREATIVE_FORMAT_BY_ID[f as CreativeFormatId]?.label ?? f}`, src: refUrl(d!.image.storagePath), storagePath: d!.image.storagePath })),
    ...Object.entries(p.pictures ?? {}).map(([a, pic]) => ({ label: `Scene ${a}`, src: refUrl(pic!.image.storagePath), storagePath: pic!.image.storagePath })),
    ...(p.upload ? [{ label: 'Your upload', src: refUrl(p.upload.storagePath), storagePath: p.upload.storagePath }] : []),
    ...photos.map(({ angle, photo }) => ({ label: `${car?.model ?? 'Car'} · ${angle}`, src: refUrl(photo.storagePath), storagePath: photo.storagePath })),
    ...(p.attachedPhotos ?? []).map((ph) => ({ label: ph.label || 'Attached photo', src: refUrl(ph.storagePath), storagePath: ph.storagePath })),
    ...[client?.logo, client?.logoWhite, client?.brandLogo, client?.brandLogoWhite]
      .filter((x): x is StoredImage => Boolean(x?.storagePath))
      .map((l) => ({ label: l.label || 'Logo', src: refUrl(l.storagePath), storagePath: l.storagePath })),
  ];

  const aspectsNeeded = pictureAspectsFor(p.formats);
  const missingPictures = aspectsNeeded.filter((a) => !p.pictures?.[a]);
  const designsMade = p.formats.length - missingDesigns.length;
  /** Why nothing can be made yet, in the words of the step that fixes it — null when it can. */
  const blockedBy = ((): string | null => {
    if (!canCreate) return 'Viewer access can look but not make — ask an admin for creator access.';
    if (busy === 'copy') return 'Writing the copy — a moment.';
    if (!p.heroPhoto && !designReference('proof')) {
      if (!car) return 'Pick the vehicle in 01, or attach a photo of it in 02 — the creative is built from a real photo.';
      return photos.length ? 'Pick the photo to build on in 02.' : `The library has no photos of the ${car.brand} ${car.model} yet — attach one in 02.`;
    }
    if (!p.formats.length) return 'Pick at least one size in 03.';
    return null;
  })();
  const canDesign = busy === '' && !blockedBy;
  const fieldsShown = [...engine.fields, ...(second?.fields ?? []).filter((f) => !engine.fields.some((g) => g.id === f.id))];
  const missing = engine.mandatory.filter((id) => !(p.facts[id] ?? '').trim());

  if (intakeOpen) {
    return (
      <ImageIntake
        p={p} set={set} clients={clients} vehicleChoices={vehicleChoices} languageChoices={languageChoices}
        canCreate={canCreate} readOnly={readOnly} busy={busy} error={error} clearError={() => setError('')}
        understanding={understanding} onUnderstand={understand} onProof={makeProof}
        onAllSizes={async () => { await makeAllSizes(); setView('work'); }}
        onRevise={(change) => reviseDesign(PROOF_FORMAT, change)}
        onSkip={() => setView('work')}
        onPickVehicle={pickVehicle}
        proofState={designState[PROOF_FORMAT]} proof={p.designs?.[PROOF_FORMAT]}
        allCost={`about ₹${p.formats.filter((f) => !madeFor(f)).length * 10}`}
        sizesTodo={p.formats.filter((f) => !madeFor(f)).length}
      />
    );
  }

  return (
    <div className="editor-page ip-page">
      <div className="crumbs">
        <button className="btn ghost small" type="button" onClick={() => go('projects', null)}>
          ← All projects
        </button>
        <span className="hint">{readOnly ? <span className="view-chip">View only</span> : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : 'Changes save automatically'}</span>
        {isAdmin && p.totalCostInr ? <span className="hint">{formatInr(p.totalCostInr)} spent</span> : null}
        {!readOnly && (
          <Confirm
            onConfirm={async () => {
              removed.current = true;
              dirty.current = false;
              const r = await api.imageProjects.remove(p.id);
              if (isApiError(r)) {
                removed.current = false;
                window.alert(`Could not delete this project: ${r.message}`);
                return;
              }
              await refresh();
              closeTab(imageTabId(p.id));
            }}
          >
            Delete project
          </Confirm>
        )}
      </div>
      {p.intake && (
        <div className="ip-intake-bar">
          <span className="chip on">{engine.label}</span>
          {second && <span className="chip on">{second.label}</span>}
          {p.intake.heard.length > 0 && <span className="hint">heard {p.intake.heard.map((h) => `"${h}"`).join(', ')}</span>}
          {p.intake.fallback && <span className="hint">read without the model</span>}
          <button type="button" className="btn ghost small" onClick={() => setView('auto')} disabled={!intakeFits}>
            Back to the intake
          </button>
        </div>
      )}
      {error && (
        <Banner kind="bad">
          {error}{' '}
          <button type="button" className="btn ghost small" onClick={() => setError('')}>
            Dismiss
          </button>
        </Banner>
      )}

      <div className="ip-columns">
        <div className="ip-left">
          <Lock>
            <Section num="01" title="Brief" defaultOpen step={engine.label} need={missing.length ? `${missing.length} to fill` : undefined}>
              <Field label="Name">
                <input value={p.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <div className="row2">
                <Field label="Client">
                  <select value={p.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value || undefined, carId: undefined, heroPhoto: undefined })}>
                    <option value="">Pick a client</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName || c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Vehicle">
                  <select
                    value={p.carId ?? ''}
                    onChange={(e) => {
                      const next = cars.find((c) => c.id === e.target.value);
                      const first = libraryPhotos(next)[0]?.photo;
                      set({ carId: e.target.value || undefined, carColour: undefined, heroPhoto: first ? { ...first, angle: libraryPhotos(next)[0]!.angle } : undefined, pictures: {} });
                    }}
                  >
                    <option value="">No particular vehicle</option>
                    {vehicleChoices.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.brand} {c.model}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {client && !vehicleChoices.length && (
                <p className="hint ip-blocked">
                  No {client.brand || 'matching'} vehicles in the library yet — add them under Cars, or attach a photo of the vehicle in 02.
                </p>
              )}
              {car && car.colours.length > 0 && (
                <Field label="Colour">
                  <select value={p.carColour ?? ''} onChange={(e) => set({ carColour: e.target.value || undefined })}>
                    <option value="">As in the photo</option>
                    {car.colours.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="What is this post about?" hint="In your words — “Navratri offer on the Creta, benefits up to ₹50,000 till 31 October”.">
                <textarea rows={3} value={p.prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Diwali greetings with a festive offer on the Venue" />
              </Field>
              <div className="ip-engine">
                <span className="ip-label">Kind of post</span>
                <span className="chip on">{engine.label}</span>
                {second && (
                  <>
                    <span className="ip-plus">+</span>
                    <span className="chip on">{second.label}</span>
                    <span className="hint">{p.engine?.ratio}</span>
                  </>
                )}
                <span className="hint">{p.engine?.manual ? 'picked by hand' : p.prompt.trim() ? 'read from the brief' : ''}</span>
              </div>
              <div className="row2">
                <Field label="Lead">
                  <select
                    value={engineId}
                    onChange={(e) => set({ engine: { primary: e.target.value as CreativeEngineId, secondary: p.engine?.secondary === e.target.value ? undefined : p.engine?.secondary, ratio: p.engine?.ratio, manual: true } })}
                  >
                    {CREATIVE_ENGINES.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.code} · {x.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Blended with">
                  <select
                    value={p.engine?.secondary ?? ''}
                    onChange={(e) =>
                      set({ engine: { primary: engineId, secondary: (e.target.value || undefined) as CreativeEngineId | undefined, ratio: e.target.value ? p.engine?.ratio ?? '60/40' : undefined, manual: true } })
                    }
                  >
                    <option value="">Nothing</option>
                    {CREATIVE_ENGINES.filter((x) => x.id !== engineId).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="hint ip-purpose">{engine.purpose}</p>
              {fieldsShown.map((f) => {
                const v = p.facts[f.id] ?? (f.id === 'occasion' ? occasion ?? '' : '');
                const need = engine.mandatory.includes(f.id);
                return (
                  <Field key={f.id} label={`${f.label}${need ? ' *' : ''}`} hint={f.type === 'list' ? `One per line${f.max ? `, up to ${f.max}` : ''}.${f.hint ? ` ${f.hint}` : ''}` : f.hint}>
                    {f.type === 'select' ? (
                      <select value={v} onChange={(e) => setFact(f.id, e.target.value)}>
                        <option value="">Pick one</option>
                        {(f.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : f.type === 'list' || f.type === 'textarea' ? (
                      <textarea rows={f.type === 'list' ? Math.min(4, f.max ?? 3) : 3} value={v} placeholder={f.placeholder} onChange={(e) => setFact(f.id, e.target.value)} />
                    ) : (
                      <input value={v} placeholder={f.placeholder} onChange={(e) => setFact(f.id, e.target.value)} />
                    )}
                  </Field>
                );
              })}
              <div className="row2">
                <Field label="Words on the picture in">
                  <select value={language.id} onChange={(e) => set({ languageId: e.target.value })}>
                    {languageChoices.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="The client's voice" hint="Signature phrases to use, words to avoid — “Always say ‘Drive the difference’. Never say ‘cheap’.”">
                <textarea rows={2} value={p.voiceNote ?? ''} onChange={(e) => set({ voiceNote: e.target.value })} />
              </Field>
            </Section>

            <Section num="02" title="The photo" defaultOpen step={p.heroPhoto ? 'Picked' : undefined} need={p.heroPhoto ? undefined : 'Pick one'} note="The picture is built from a real photo of the vehicle, so the car is never an imagined one.">
              {!car && !(p.attachedPhotos ?? []).length ? (
                <p className="hint">Pick the vehicle above, or attach a photo of it — either is enough to make the creatives.</p>
              ) : null}
              <div className="ip-photos">
                {[...photos.map(({ angle, photo }) => ({ ...photo, angle })), ...(p.attachedPhotos ?? [])].map((ph) => {
                  const on = p.heroPhoto?.storagePath === ph.storagePath;
                  return (
                    <button
                      key={ph.storagePath}
                      type="button"
                      className={`ip-photo${on ? ' on' : ''}`}
                      onClick={() => set({ heroPhoto: ph })}
                      title={ph.label || ph.angle}
                      aria-pressed={on}
                    >
                      <img src={refUrl(ph.storagePath)} alt={ph.label || ph.angle || 'Vehicle photo'} loading="lazy" crossOrigin="anonymous" />
                      {(ph.angle || (ph as AttachedPhoto).role) && <span>{ph.angle ?? ROLE_LABEL_SHORT[(ph as AttachedPhoto).role!]}</span>}
                    </button>
                  );
                })}
              </div>
              {!readOnly && (
                <ImageUpload
                  label={car ? `${car.brand} ${car.model}` : 'Vehicle photo'}
                  kind="car-model"
                  buttonText="Attach a photo"
                  onUploaded={(img) => set((cur) => ({ attachedPhotos: [...(cur.attachedPhotos ?? []), img], heroPhoto: img }))}
                />
              )}
            </Section>

            <Section num="03" title="Sizes and look" defaultOpen step={`${p.formats.length} size${p.formats.length === 1 ? '' : 's'}`}>
              {(
                [
                  ['Social', SOCIAL_FORMATS],
                  ['CarDekho ad set', AD_FORMATS],
                ] as const
              ).map(([group, list]) => {
                const all = list.every((f) => p.formats.includes(f.id));
                return (
              <div key={group} className="ip-formats">
                <div className="ip-format-group">
                  <span>{group}</span>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() =>
                      set((cur) => {
                        const ids = list.map((f) => f.id as CreativeFormatId);
                        const next = all ? cur.formats.filter((id) => !ids.includes(id)) : [...cur.formats, ...ids.filter((id) => !cur.formats.includes(id))];
                        return { formats: CREATIVE_FORMATS.map((x) => x.id).filter((id) => next.includes(id)) };
                      })
                    }
                  >
                    {all ? 'Clear these' : `All ${list.length}`}
                  </button>
                </div>
                {list.map((f) => {
                  const on = p.formats.includes(f.id);
                  return (
                    <label key={f.id} className={`ip-format${on ? ' on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => set((cur) => ({ formats: e.target.checked ? CREATIVE_FORMATS.map((x) => x.id).filter((id) => id === f.id || cur.formats.includes(id)) : cur.formats.filter((id) => id !== f.id) }))}
                      />
                      <span className="ip-format-shape" style={{ aspectRatio: `${f.width} / ${f.height}` }} aria-hidden />
                      <span>
                        <b>{f.label}</b>
                        <small>
                          {f.width}×{f.height} · {f.platforms}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
                );
              })}
              <Field label="Colours">
                <div className="seg">
                  {(
                    [
                      ['theme', 'A look'],
                      ['brand', 'Brand colours'],
                      ['occasion', 'Occasion colours'],
                      ['custom', 'Your own'],
                    ] as const
                  ).map(([id, label]) => (
                    <button key={id} type="button" className={p.look.source === id ? 'on' : ''} onClick={() => set({ look: { ...p.look, source: id } })}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              {p.look.source === 'theme' && (
                <div className="ip-looks">
                  {OVERLAY_THEMES.map((t) => (
                    <button key={t.id} type="button" className={`ip-look${(p.look.themeId ?? 'midnight') === t.id ? ' on' : ''}`} onClick={() => set({ look: { source: 'theme', themeId: t.id } })} title={t.name}>
                      <span style={{ background: t.panel }} />
                      <span style={{ background: t.accent }} />
                      <small>{t.name}</small>
                    </button>
                  ))}
                </div>
              )}
              {p.look.source === 'brand' && <p className="hint">{look.id === 'brand' ? `${client?.brand}'s own colours.` : `No colours on file for ${client?.brand || 'this brand'} — the default look is used.`}</p>}
              {p.look.source === 'occasion' && <p className="hint">{look.id === 'occasion' ? `Dressed for ${occasion}.` : 'Name the occasion in the brief to use its colours.'}</p>}
              {p.look.source === 'custom' && (
                <div className="row2">
                  <Field label="Panel">
                    <input type="color" value={p.look.custom?.panel ?? '#0f1e33'} onChange={(e) => set({ look: { source: 'custom', custom: { panel: e.target.value, accent: p.look.custom?.accent ?? '#e2600a' } } })} />
                  </Field>
                  <Field label="Accent">
                    <input type="color" value={p.look.custom?.accent ?? '#e2600a'} onChange={(e) => set({ look: { source: 'custom', custom: { panel: p.look.custom?.panel ?? '#0f1e33', accent: e.target.value } } })} />
                  </Field>
                </div>
              )}
              <div className="row2">
                <Field label="Layout">
                  <select value={p.templateId ?? ''} onChange={(e) => set({ templateId: (e.target.value || undefined) as ImageProject['templateId'] })}>
                    <option value="">For this kind of post — {CREATIVE_TEMPLATES.find((t) => t.id === engine.template)?.name}</option>
                    {CREATIVE_TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {t.note}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Dealer panel">
                  <div className="seg">
                    {(
                      [
                        ['full', 'Full'],
                        ['compact', 'One line'],
                        ['none', 'None'],
                      ] as const
                    ).map(([id, label]) => (
                      <button key={id} type="button" className={p.panelStyle === id ? 'on' : ''} onClick={() => set({ panelStyle: id })}>
                        {label}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
              {!client?.logo && !client?.brandLogo && client && <p className="hint">This client has no logos yet — add them in Clients and they appear here.</p>}
            </Section>

            <Section
              num="04"
              title="The words"
              defaultOpen
              step={p.copy ? 'Written' : 'Draft from the facts'}
              note="The words set on the creative, and only those. Rupees, asterisks and the T&C line are kept to the rules after writing; the dealership's name and contact are the panel's, and the post's own caption belongs to the tool that posts it."
            >
              <div className="ip-actions">
                <button type="button" className="btn primary small" disabled={!canCreate || busy !== '' || !client} onClick={() => void writeCopy()}>
                  {busy === 'copy' ? 'Writing…' : p.copy ? 'Write it again' : 'Write the copy'}
                </button>
                {!client && <span className="hint">Pick the client first.</span>}
              </div>
              <Field label="Headline">
                <input value={copy.headline} onChange={(e) => setCopy({ headline: e.target.value })} />
              </Field>
              {copy.alternatives.length > 0 && (
                <div className="ip-alts">
                  <span className="hint">Or:</span>
                  {copy.alternatives.map((a) => (
                    <button key={a} type="button" className="chip" onClick={() => setCopy({ headline: a, alternatives: [copy.headline, ...copy.alternatives.filter((x) => x !== a)] })}>
                      {a}
                    </button>
                  ))}
                </div>
              )}
              <div className="row2">
                <Field label="Small line above">
                  <input value={copy.kicker} onChange={(e) => setCopy({ kicker: e.target.value })} />
                </Field>
                <Field label="Badge">
                  <input value={copy.badge} onChange={(e) => setCopy({ badge: e.target.value })} placeholder="Benefits up to ₹50,000*" />
                </Field>
              </div>
              <Field label="Second line">
                <input value={copy.sub} onChange={(e) => setCopy({ sub: e.target.value })} />
              </Field>
              <Field label="Points" hint="One per line, up to four.">
                <textarea rows={3} value={copy.points.join('\n')} onChange={(e) => setCopy({ points: e.target.value.split('\n').slice(0, 4) })} />
              </Field>
              <div className="row2">
                <Field label="Call to action">
                  <input value={copy.cta} onChange={(e) => setCopy({ cta: e.target.value })} />
                </Field>
                <Field label="Small print">
                  <input value={copy.terms} onChange={(e) => setCopy({ terms: e.target.value })} />
                </Field>
              </div>
            </Section>

            <Section
              num="05"
              title={p.pictureMode === 'design' ? 'Make the creatives' : 'Picture'}
              defaultOpen
              step={
                p.pictureMode === 'design'
                  ? `Nano Banana 2 · ${designsMade} of ${p.formats.length} made`
                  : p.pictureMode === 'scene'
                    ? `${aspectsNeeded.filter((a) => p.pictures?.[a]).length} of ${aspectsNeeded.length} made`
                    : p.pictureMode === 'photo'
                      ? 'Photo as it is'
                      : 'Your upload'
              }
              note={
                p.pictureMode === 'design'
                  ? 'Nano Banana 2 designs each size whole: the real car from its photos, a scene for the post, and your copy set into it. The logos and the dealer panel go on top exactly as they are, and every word is read back and checked against the copy.'
                  : 'A scene puts the real car in a setting for the occasion, one picture per shape of size. It carries no words — they are the layers you edit.'
              }
            >
              <div className="seg">
                {(
                  [
                    ['design', 'Nano Banana 2'],
                    ['scene', 'Scene, words on top'],
                    ['photo', 'Photo as it is'],
                    ['upload', 'Upload'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" className={p.pictureMode === id ? 'on' : ''} onClick={() => set({ pictureMode: id as PictureMode })}>
                    {label}
                  </button>
                ))}
              </div>
              {p.pictureMode === 'design' && (
                <>
                  <Field label="The scene" hint={`Left empty: ${occasion ? `dressed for ${occasion}` : engine.scene}.`}>
                    <input value={p.sceneNote ?? ''} onChange={(e) => set({ sceneNote: e.target.value })} placeholder="At the showroom entrance at dusk" />
                  </Field>
                  <div className="ip-actions">
                    {missingDesigns.length > 0 && missingDesigns.length < p.formats.length ? (
                      <>
                        <button type="button" className="btn primary small" disabled={!canDesign} onClick={() => void makeDesigns(missingDesigns)}>
                          {busy === 'design' ? 'Designing…' : `Make the missing ${missingDesigns.length === 1 ? 'one' : missingDesigns.length}`}
                        </button>
                        <button type="button" className="btn ghost small" disabled={!canDesign} onClick={() => void makeDesigns()}>
                          Make them all again
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn primary small" disabled={!canDesign || !p.formats.length} onClick={() => void makeDesigns()}>
                        {busy === 'design' ? 'Designing…' : missingDesigns.length ? `Make the creative${p.formats.length === 1 ? '' : 's'}` : 'Make them all again'}
                      </button>
                    )}
                    {blockedBy ? (
                      <span className="hint ip-blocked">{blockedBy}</span>
                    ) : (
                      <span className="hint">
                        {(missingDesigns.length || p.formats.length)} size{(missingDesigns.length || p.formats.length) === 1 ? '' : 's'} · about ₹9 and half a minute each · made once more when a check fails
                      </span>
                    )}
                  </div>
                  {!p.copy && <p className="hint">The words are still the draft. Write the copy in 04 first — Nano Banana 2 sets exactly the words it is given.</p>}
                  <div className="ip-scenes">
                    {p.formats.map((format) => {
                      const f = CREATIVE_FORMAT_BY_ID[format];
                      const state = designState[format];
                      if (!designsWhole(format)) {
                        const pic = p.pictures?.[f.pictureAspect];
                        return (
                          <div key={format} className="ip-scene ip-design">
                            <div className="ip-scene-img" style={{ aspectRatio: f.pictureAspect.replace(':', ' / ') }}>
                              {state === 'working' ? <span>Drawing…</span> : pic ? <img src={refUrl(pic.image.storagePath)} alt={`${f.label}, picture`} crossOrigin="anonymous" /> : <span>{state === 'failed' ? 'Failed' : `${f.width}×${f.height}`}</span>}
                            </div>
                            <span className="ip-check" title="Wider than Nano Banana 2 draws: it makes the picture, and the words are laid on it — every one exact and editable.">
                              {f.width}×{f.height} · picture, words on top
                            </span>
                            {pic?.check && (
                              <span className={`ip-check ${pic.check.checked ? (pic.check.same ? 'ok' : 'bad') : ''}`} title={pic.check.why}>
                                {pic.check.checked ? (pic.check.same ? 'Same vehicle ✓' : 'Vehicle may differ') : 'Vehicle not checked'}
                              </span>
                            )}
                            {pic && (
                              <button type="button" className="btn ghost small" disabled={!canDesign} onClick={() => void makeDesigns([format])} title={`Draw the ${f.label} picture again`}>
                                Again
                              </button>
                            )}
                          </div>
                        );
                      }
                      const d = p.designs?.[format];
                      const stale = d ? !sameDesignWords(d.words, designBrief(format).words) : false;
                      const words = d?.checks.words;
                      return (
                        <div key={format} className="ip-scene ip-design">
                          <div className="ip-scene-img" style={{ aspectRatio: `${f.width} / ${f.height}` }}>
                            {state === 'working' ? (
                              <span>Designing…</span>
                            ) : d ? (
                              <img src={refUrl(d.image.storagePath)} alt={`${f.label}, designed`} crossOrigin="anonymous" />
                            ) : (
                              <span>{state === 'failed' ? 'Failed' : f.label}</span>
                            )}
                          </div>
                          {d && (
                            <>
                              <span className={`ip-check ${d.checks.vehicle.checked ? (d.checks.vehicle.same ? 'ok' : 'bad') : ''}`} title={d.checks.vehicle.why}>
                                {d.checks.vehicle.checked ? (d.checks.vehicle.same ? 'Same vehicle ✓' : 'Vehicle may differ') : 'Vehicle not checked'}
                              </span>
                              <span className={`ip-check ${words?.checked ? (words.ok ? 'ok' : 'bad') : ''}`}>
                                {words?.checked ? (words.ok ? 'Words ✓' : `Words: ${words.missing.length + words.extra.length} to check`) : 'Words not checked'}
                              </span>
                              {d.checks.logos?.checked && (
                                <span className={`ip-check ${d.checks.logos.kept && !d.checks.logos.extra ? 'ok' : 'bad'}`} title={d.checks.logos.drift !== undefined ? `Logo drift ${d.checks.logos.drift}/255` : undefined}>
                                  {!d.checks.logos.kept ? 'Logos moved — check them' : d.checks.logos.extra ? `${d.checks.logos.extra} logo${d.checks.logos.extra === 1 ? '' : 's'} not yours` : 'Logos ✓'}
                                </span>
                              )}
                              {words?.checked && !words.ok && (
                                <ul className="ip-check-list">
                                  {words.missing.map((m) => (
                                    <li key={`m${m}`}>Not as written: “{m}”</li>
                                  ))}
                                  {words.extra.map((x) => (
                                    <li key={`x${x}`}>Not asked for: “{x}”</li>
                                  ))}
                                </ul>
                              )}
                              {stale && <span className="ip-check bad">The copy changed since</span>}
                              {d.revision && (
                                <span className="ip-check" title={d.revision}>
                                  Changed: “{d.revision.length > 40 ? `${d.revision.slice(0, 40)}…` : d.revision}”
                                </span>
                              )}
                              <button type="button" className="btn ghost small" disabled={!canDesign} onClick={() => void makeDesigns([format])} title={`Design the ${f.label} again`}>
                                Again
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {p.pictureMode === 'scene' && (
                <>
                  <Field label="The scene" hint={`Left empty: ${occasion ? `dressed for ${occasion}` : engine.scene}.`}>
                    <input value={p.sceneNote ?? ''} onChange={(e) => set({ sceneNote: e.target.value })} placeholder="At the showroom entrance at dusk" />
                  </Field>
                  <div className="ip-actions">
                    {missingPictures.length > 0 && missingPictures.length < aspectsNeeded.length ? (
                      <>
                        <button type="button" className="btn primary small" disabled={!canDesign} onClick={() => void makePictures(missingPictures)}>
                          {busy === 'scene' ? 'Making the pictures…' : `Make the missing ${missingPictures.length === 1 ? 'one' : missingPictures.length}`}
                        </button>
                        <button type="button" className="btn ghost small" disabled={!canDesign} onClick={() => void makePictures()}>
                          Make them all again
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn primary small" disabled={!canDesign} onClick={() => void makePictures()}>
                        {busy === 'scene' ? 'Making the pictures…' : missingPictures.length ? `Make the picture${aspectsNeeded.length === 1 ? '' : 's'}` : 'Make them again'}
                      </button>
                    )}
                    {blockedBy ? (
                      <span className="hint ip-blocked">{blockedBy}</span>
                    ) : (
                      <span className="hint">
                        {(missingPictures.length || aspectsNeeded.length)} picture{(missingPictures.length || aspectsNeeded.length) === 1 ? '' : 's'} ({(missingPictures.length ? missingPictures : aspectsNeeded).join(', ')}) · about half a minute each
                      </span>
                    )}
                  </div>
                  <div className="ip-scenes">
                    {aspectsNeeded.map((a) => {
                      const pic = p.pictures?.[a];
                      const state = sceneState[a];
                      return (
                        <div key={a} className="ip-scene">
                          <div className="ip-scene-img" style={{ aspectRatio: a.replace(':', ' / ') }}>
                            {pic ? <img src={refUrl(pic.image.storagePath)} alt={`Scene ${a}`} crossOrigin="anonymous" /> : <span>{state === 'working' ? 'Making…' : state === 'failed' ? 'Failed' : a}</span>}
                          </div>
                          {pic?.check && (
                            <span className={`ip-check ${pic.check.checked ? (pic.check.same ? 'ok' : 'bad') : ''}`} title={pic.check.why}>
                              {pic.check.checked ? (pic.check.same ? 'Same vehicle ✓' : 'May differ — check it') : 'Not checked'}
                            </span>
                          )}
                          {pic && (
                            <button type="button" className="btn ghost small" disabled={!canDesign} onClick={() => void makePictures([a])} title={`Make the ${a} picture again`}>
                              Again
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {p.pictureMode === 'photo' && <p className="hint">The photo you picked, whole, on a soft blurred copy of itself. Free and instant — the car is exactly as photographed.</p>}
              {p.pictureMode === 'upload' && (
                <>
                  {!readOnly && <ImageUpload label={`${p.name} picture`} kind="extra" buttonText={p.upload ? 'Upload another' : 'Upload a picture'} onUploaded={(img) => set({ upload: img })} />}
                  {p.upload && <img className="ip-upload" src={refUrl(p.upload.storagePath)} alt="Your upload" crossOrigin="anonymous" />}
                  <p className="hint">A delivery photo with the customer, a showroom shot — anything you want the words laid over.</p>
                </>
              )}
            </Section>
          </Lock>
        </div>

        <div className="ip-right">
          <div className="card ip-out">
            <div className="head">
              <div className="head-left">
                <h3>Creatives</h3>
              </div>
              <div className="ip-actions">
                <button type="button" className="btn small" disabled={downloading || !creatives.length} onClick={() => void downloadAll()}>
                  {downloading ? 'Packing…' : 'Download all'}
                </button>
              </div>
            </div>
            <div className="body">
              {!creatives.length && <div className="empty">Pick at least one size.</div>}
              {creatives.map(({ format, kept, doc }) => {
                const f = CREATIVE_FORMAT_BY_ID[format];
                return (
                  <div key={format} className={`ip-creative${kept?.approved ? ' approved' : ''}`}>
                    <div className="ip-creative-head">
                      <b>{f.label}</b>
                      <small>
                        {f.width}×{f.height}
                        {p.pictureMode === 'design' ? (madeFor(format) ? ' · Nano Banana 2' : ' · draft') : ''}
                        {kept ? ' · edited' : ''}
                        {kept?.approved ? ' · approved' : ''}
                      </small>
                    </div>
                    <button type="button" className="ip-creative-canvas" onClick={() => setEditing({ format, doc })} title="Open in the editor">
                      <CreativeCanvas doc={doc} width={Math.min(f.width, f.width > f.height ? 460 : f.width === f.height ? 380 : 300)} />
                    </button>
                    <div className="ip-actions">
                      <button type="button" className="btn small primary" onClick={() => setEditing({ format, doc })}>
                        Edit
                      </button>
                      <button type="button" className="btn small ghost" onClick={() => void download(doc, format, 'image/png')}>
                        PNG
                      </button>
                      <button type="button" className="btn small ghost" onClick={() => void download(doc, format, 'image/jpeg')}>
                        JPG
                      </button>
                      {canCreate && !readOnly && (
                        <button type="button" className={`btn small ${kept?.approved ? '' : 'ghost'}`} onClick={() => void approve(format, doc, !kept?.approved)}>
                          {kept?.approved ? 'Approved ✓' : 'Approve'}
                        </button>
                      )}
                      {kept && canCreate && !readOnly && (
                        <button type="button" className="btn small ghost" onClick={() => resetCreative(format)} title="Lay it out again from the brief">
                          Reset
                        </button>
                      )}
                      {p.pictureMode === 'design' && !madeFor(format) && canCreate && !readOnly && (
                        <button type="button" className="btn small ghost" disabled={!canDesign} onClick={() => void makeDesigns([format])} title={blockedBy ?? 'Nano Banana 2 designs this size'}>
                          {designState[format] === 'working' ? 'Designing…' : 'Design it'}
                        </button>
                      )}
                    </div>
                    {p.pictureMode === 'design' && designsWhole(format) && p.designs?.[format] && canCreate && !readOnly && (
                      <form
                        className="ip-ask"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void reviseDesign(format);
                        }}
                      >
                        <input
                          value={changes[format] ?? ''}
                          onChange={(e) => setChanges((c) => ({ ...c, [format]: e.target.value }))}
                          placeholder="Ask Nano Banana 2 for a change — “make the headline gold”"
                          aria-label={`A change to the ${f.label}`}
                          maxLength={400}
                        />
                        <button type="submit" className="btn small" disabled={!changes[format]?.trim() || designState[format] === 'working' || busy !== ''}>
                          {designState[format] === 'working' ? 'Changing…' : 'Ask'}
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <CreativeEditor
          doc={editing.doc}
          title={`${CREATIVE_FORMAT_BY_ID[editing.format].label} · ${p.name}`}
          readOnly={!canCreate || readOnly}
          library={editorLibrary}
          onUpload={
            canCreate && !readOnly
              ? async (file) => {
                  const r = await uploadRef(file, file.name || 'Picture', 'extra');
                  return isApiError(r) ? null : { src: refUrl(r.storagePath), storagePath: r.storagePath };
                }
              : undefined
          }
          onSave={async (doc) => {
            await saveCreative(editing.format, doc);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
