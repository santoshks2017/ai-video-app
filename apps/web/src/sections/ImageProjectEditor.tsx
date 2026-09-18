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
  emptyCopy,
  factRows,
  formatInr,
  layoutCreative,
  wordsBand,
  logoLayout,
  occasionIn,
  pictureAspectsFor,
  tidyCopy,
  type CarAngle,
  type CarModelProfile,
  type ClientProfile,
  type CopyClient,
  type CreativeCopy,
  type CreativeDoc,
  type CreativeEngineId,
  type CreativeFormatId,
  type CreativeLogoArt,
  type ImageCreative,
  type ImageProject,
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
import { drawCreativeScene, writeCreativeCopy, type CopyRequest } from '../lib/creatives.js';
import { Banner, Confirm, Field, ImageUpload, Lock, Section, useReadOnly } from '../components/ui.js';
import { CreativeCanvas } from '../components/creative/CreativeCanvas.js';
import { CreativeEditor, type EditorPicture } from '../components/creative/CreativeEditor.js';
import { downloadBlob, exportCreative, fileNameOf } from '../components/creative/render.js';
import { zipFiles } from '../components/creative/zip.js';

const ANGLES: CarAngle[] = ['front', 'side', 'rear', 'interior'];
const ASPECT_TEXT_BAND: Record<PictureAspect, 'top' | 'left'> = { '1:1': 'top', '4:5': 'top', '9:16': 'top', '16:9': 'left' };

/* ---- what the page needs from the client and the car ---- */

function copyClientOf(c: ClientProfile | undefined): CopyClient & { segment?: string; styleNote?: string } {
  if (!c) return { name: '' };
  return {
    name: c.displayName || c.name,
    kind: c.kind === 'oem' ? 'oem' : 'dealer',
    brand: c.brand,
    city: c.city,
    address: c.address,
    phone: c.phone,
    website: c.website,
    tagline: c.tagline,
    footerText: c.footerText,
    instagram: c.social?.instagram,
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
  const [busy, setBusy] = useState<'' | 'copy' | 'scene'>('');
  const [error, setError] = useState('');
  const [sceneState, setSceneState] = useState<Partial<Record<PictureAspect, 'working' | 'failed'>>>({});
  /** The size open in the editor, with the document as it was when it opened. */
  const [editing, setEditing] = useState<{ format: CreativeFormatId; doc: CreativeDoc } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

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
    return tidyCopy(draftCopy(p, client, car), { client: copyClientOf(client), model: car?.model, validity: p.facts.validity, native: language.script === 'indic' });
  }, [p, client, car, language.script]);

  /** The picture a size is built on: its scene, the photo as it is, or the upload. */
  const pictureFor = (format: CreativeFormatId): LayoutInput['picture'] => {
    if (!p) return undefined;
    const aspect = CREATIVE_FORMAT_BY_ID[format].pictureAspect;
    const scene = p.pictures?.[aspect];
    if (p.pictureMode === 'scene' && scene) return { src: refUrl(scene.image.storagePath), storagePath: scene.image.storagePath, mode: 'scene' };
    if (p.pictureMode === 'upload' && p.upload) return { src: refUrl(p.upload.storagePath), storagePath: p.upload.storagePath, mode: 'upload' };
    if (p.heroPhoto) return { src: refUrl(p.heroPhoto.storagePath), storagePath: p.heroPhoto.storagePath, mode: 'photo' };
    return undefined;
  };

  const autoDoc = (format: CreativeFormatId): CreativeDoc =>
    layoutCreative({
      format,
      template: p?.templateId ?? engine.template,
      copy,
      look,
      picture: pictureFor(format),
      logos: { dealer: art(client?.logo, client?.logoWhite), brand: art(client?.brandLogo, client?.brandLogoWhite), placement: logoLayout(client?.logoPlacement) },
      panel: panelOf(client, p?.panelStyle ?? 'full'),
      script: language.script,
    });

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

  /* ---- actions ---- */

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
  const setCopy = (patch: Partial<CreativeCopy>): void =>
    set((cur) => {
      const next = { ...(cur.copy ?? copy), ...patch };
      // Words changed here reach the sizes someone already edited, without undoing their changes.
      return { copy: next, creatives: cur.creatives.map((c) => ({ ...c, doc: applyCopyToCreative(c.doc, next) })) };
    });

  const writeCopy = async (): Promise<void> => {
    if (!client) return setError('Pick the client first — the copy is written in their name.');
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
    if (isApiError(r)) return setError(r.message);
    setCopy(r.copy);
  };

  /** How far down the words reach on the size a picture is made for, so the picture leaves them room. */
  const bandFor = (aspect: PictureAspect): number | undefined => {
    const shown = creatives.find((c) => CREATIVE_FORMAT_BY_ID[c.format].pictureAspect === aspect);
    return shown ? wordsBand(shown.doc) : undefined;
  };

  /** Pictures for the sizes' shapes: the ones asked for, or every shape the sizes need. */
  const makePictures = async (only?: PictureAspect[]): Promise<void> => {
    if (!car || !p.heroPhoto) return setError('Pick the vehicle and the photo to build on first.');
    const aspects = only ?? pictureAspectsFor(p.formats);
    if (!aspects.length) return;
    setBusy('scene');
    setError('');
    const others = photos.filter((x) => x.photo.storagePath !== p.heroPhoto!.storagePath);
    const refs = [
      { storagePath: p.heroPhoto.storagePath, label: `the ${car.brand} ${car.model}${p.heroPhoto.angle ? `, ${p.heroPhoto.angle}` : ''}` },
      // The vehicle's other sides; the cabin only when the picture is of the cabin.
      ...ANGLES.filter((a) => a !== 'interior' || p.heroPhoto!.angle === 'interior')
        .map((a) => others.find((x) => x.angle === a && a !== p.heroPhoto!.angle))
        .filter((x): x is { angle: CarAngle; photo: StoredImage } => Boolean(x))
        .slice(0, 3)
        .map((x) => ({ storagePath: x.photo.storagePath, label: `the ${car.brand} ${car.model}, ${x.angle}` })),
    ];
    setSceneState(Object.fromEntries(aspects.map((a) => [a, 'working'])));
    await Promise.all(
      aspects.map(async (aspect) => {
        const r = await drawCreativeScene(
          p.id,
          {
            aspect,
            engine: engineId,
            occasion,
            vehicle: { name: `${car.brand} ${car.model}`, colour: p.carColour, kind: car.kind === 'bike' ? 'bike' : 'car' },
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
      const file = new File([blob], fileNameOf(`${p.name}-${CREATIVE_FORMAT_BY_ID[format].label}`, 'png'), { type: 'image/png' });
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
      downloadBlob(blob, fileNameOf(`${p.name}-${CREATIVE_FORMAT_BY_ID[format].label}`, type === 'image/png' ? 'png' : 'jpg'));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  /** The post's words for the platform: the caption, its hashtags and the search line. */
  const captionText = [copy.caption, copy.hashtags.join(' '), copy.seo].filter((s) => s.trim()).join('\n\n');
  const downloadAll = async (): Promise<void> => {
    setDownloading(true);
    try {
      const files = await Promise.all(
        creatives.map(async (c) => ({ name: fileNameOf(`${p.name}-${CREATIVE_FORMAT_BY_ID[c.format].label}`, 'png'), blob: await exportCreative(c.doc, 'image/png') })),
      );
      // The caption travels with the pictures, ready to paste.
      if (captionText) files.push({ name: 'caption.txt', blob: new Blob([captionText], { type: 'text/plain' }) });
      downloadBlob(await zipFiles(files), fileNameOf(p.name || 'creatives', 'zip'));
    } catch (e) {
      setError((e as Error).message);
    }
    setDownloading(false);
  };
  const copyCaption = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(captionText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('The caption could not be copied — select it and copy it by hand.');
    }
  };

  /* ---- the editor ---- */

  const editorLibrary: EditorPicture[] = [
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
  const fieldsShown = [...engine.fields, ...(second?.fields ?? []).filter((f) => !engine.fields.some((g) => g.id === f.id))];
  const missing = engine.mandatory.filter((id) => !(p.facts[id] ?? '').trim());

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
                <p className="hint">Pick the vehicle above, or attach a photo of it.</p>
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
                      {ph.angle && <span>{ph.angle}</span>}
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
              <div className="ip-formats">
                {CREATIVE_FORMATS.map((f) => {
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

            <Section num="04" title="Copy" defaultOpen step={p.copy ? 'Written' : 'Draft from the facts'} note="Rupees, asterisks, the T&C line and the contact block are kept to the rules after writing.">
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
              <Field label="Caption">
                <textarea rows={6} value={copy.caption} onChange={(e) => setCopy({ caption: e.target.value })} placeholder="Written with the copy." />
              </Field>
              <Field label="Hashtags">
                <textarea rows={2} value={copy.hashtags.join(' ')} onChange={(e) => setCopy({ hashtags: e.target.value.split(/\s+/).filter(Boolean) })} />
              </Field>
            </Section>

            <Section
              num="05"
              title="Picture"
              defaultOpen
              step={p.pictureMode === 'scene' ? `${aspectsNeeded.filter((a) => p.pictures?.[a]).length} of ${aspectsNeeded.length} made` : p.pictureMode === 'photo' ? 'Photo as it is' : 'Your upload'}
              note="A scene puts the real car in a setting for the occasion, one picture per shape of size. It carries no words — they are the layers you edit."
            >
              <div className="seg">
                {(
                  [
                    ['scene', 'Scene'],
                    ['photo', 'Photo as it is'],
                    ['upload', 'Upload'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" className={p.pictureMode === id ? 'on' : ''} onClick={() => set({ pictureMode: id as PictureMode })}>
                    {label}
                  </button>
                ))}
              </div>
              {p.pictureMode === 'scene' && (
                <>
                  <Field label="The scene" hint={`Left empty: ${occasion ? `dressed for ${occasion}` : engine.scene}.`}>
                    <input value={p.sceneNote ?? ''} onChange={(e) => set({ sceneNote: e.target.value })} placeholder="At the showroom entrance at dusk" />
                  </Field>
                  <div className="ip-actions">
                    {missingPictures.length > 0 && missingPictures.length < aspectsNeeded.length ? (
                      <>
                        <button type="button" className="btn primary small" disabled={!canCreate || busy !== '' || !p.heroPhoto || !car} onClick={() => void makePictures(missingPictures)}>
                          {busy === 'scene' ? 'Making the pictures…' : `Make the missing ${missingPictures.length === 1 ? 'one' : missingPictures.length}`}
                        </button>
                        <button type="button" className="btn ghost small" disabled={!canCreate || busy !== '' || !p.heroPhoto || !car} onClick={() => void makePictures()}>
                          Make them all again
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn primary small" disabled={!canCreate || busy !== '' || !p.heroPhoto || !car} onClick={() => void makePictures()}>
                        {busy === 'scene' ? 'Making the pictures…' : missingPictures.length ? `Make the picture${aspectsNeeded.length === 1 ? '' : 's'}` : 'Make them again'}
                      </button>
                    )}
                    <span className="hint">
                      {(missingPictures.length || aspectsNeeded.length)} picture{(missingPictures.length || aspectsNeeded.length) === 1 ? '' : 's'} ({(missingPictures.length ? missingPictures : aspectsNeeded).join(', ')}) · about half a minute each
                    </span>
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
                            <button type="button" className="btn ghost small" disabled={!canCreate || busy !== '' || !p.heroPhoto || !car} onClick={() => void makePictures([a])} title={`Make the ${a} picture again`}>
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
                <button type="button" className="btn small ghost" onClick={() => void copyCaption()} disabled={!copy.caption.trim()}>
                  {copied ? 'Copied' : 'Copy caption'}
                </button>
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
                        {kept ? ' · edited' : ''}
                        {kept?.approved ? ' · approved' : ''}
                      </small>
                    </div>
                    <button type="button" className="ip-creative-canvas" onClick={() => setEditing({ format, doc })} title="Open in the editor">
                      <CreativeCanvas doc={doc} width={f.width > f.height ? 460 : f.width === f.height ? 380 : 300} />
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
                    </div>
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
