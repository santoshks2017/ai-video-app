import { useState } from 'react';
import {
  CREATIVE_ENGINES, CREATIVE_ENGINE_BY_ID, CREATIVE_FORMATS, occasionIn,
  type AttachedPhoto, type CarModelProfile, type ClientProfile, type CreativeEngineId,
  type DesignedCreative, type ImageProject, type ImageRole, type ReferenceIntent,
} from '@ava/shared';
import { refUrl } from '../lib/api.js';
import { Banner, Field, ImageUpload } from '../components/ui.js';

const ROLE_LABEL: Record<ImageRole, string> = { vehicle: 'Vehicle photo', creative: 'Finished creative', moment: 'Moment photo', logo: 'Logo' };
const ROLE_ORDER: ImageRole[] = ['vehicle', 'creative', 'moment', 'logo'];
const INTENT_LABEL: Record<ReferenceIntent, string> = { recreate: 'Recreate it', edit: 'Change elements', sizes: 'Other sizes of it' };

export interface ImageIntakeProps {
  p: ImageProject;
  set: (patch: Partial<ImageProject> | ((cur: ImageProject) => Partial<ImageProject>)) => void;
  clients: ClientProfile[];
  vehicleChoices: CarModelProfile[];
  languageChoices: Array<{ id: string; name: string }>;
  canCreate: boolean;
  readOnly: boolean;
  busy: string;
  error: string;
  clearError: () => void;
  understanding: boolean;
  onUnderstand: () => Promise<void>;
  onProof: () => Promise<void>;
  onAllSizes: () => Promise<void>;
  onRevise: (change: string) => Promise<void>;
  onSkip: () => void;
  /** A vehicle picked by hand: the editor sets it and moves a library hero on to the new car's photo. */
  onPickVehicle: (carId: string | undefined) => void;
  proofState?: 'working' | 'failed';
  proof?: DesignedCreative;
  allCost: string;   // "about ₹36" — computed by the editor
  sizesTodo: number; // how many the fan-out will make
}

export function ImageIntake({ p, set, clients, vehicleChoices, languageChoices, canCreate, readOnly, busy, error, clearError, understanding, onUnderstand, onProof, onAllSizes, onRevise, onSkip, onPickVehicle, proofState, proof, allCost, sizesTodo }: ImageIntakeProps) {
  const [change, setChange] = useState('');
  const engine = CREATIVE_ENGINE_BY_ID[p.engine?.primary ?? 'feature'];
  const second = p.engine?.secondary ? CREATIVE_ENGINE_BY_ID[p.engine.secondary] : undefined;
  const occasion = p.facts.occasion || occasionIn(p.prompt) || undefined;
  const fields = [...engine.fields, ...(second?.fields ?? []).filter((f) => !engine.fields.some((g) => g.id === f.id))];
  /** A fact as its field shows it — the occasion falls back to the one the brief names. */
  const factValue = (id: string): string => p.facts[id] ?? (id === 'occasion' ? occasion ?? '' : '');
  const missing = engine.mandatory.filter((id) => !factValue(id).trim());
  const read = Boolean(p.intake);
  const sizesIntent = p.reference?.intent === 'sizes';
  // Not while a design is being made: a second reading would pull the plan out from under it.
  const canRead = !readOnly && canCreate && !understanding && busy === '' && proofState !== 'working' && (p.prompt.trim().length > 0 || (p.attachedPhotos ?? []).length > 0);
  /** A real photo to build the picture on: the hero, a style reference, or a moment photo. */
  const hasPhoto = Boolean(p.heroPhoto) || Boolean(p.reference) || (p.attachedPhotos ?? []).some((x) => x.role === 'moment');
  const canProve = read && canCreate && !readOnly && busy === '' && proofState !== 'working' && !missing.length && !(p.engine == null) && hasPhoto;
  const setRole = (ph: AttachedPhoto, role: ImageRole): void =>
    set((cur) => {
      const attachedPhotos = (cur.attachedPhotos ?? []).map((x) => (x.storagePath === ph.storagePath ? { ...x, role } : x));
      const creative = attachedPhotos.find((x) => x.role === 'creative');
      const wasHero = cur.heroPhoto?.storagePath === ph.storagePath;
      // The hero is only ever a photograph of the vehicle. Retagging it as anything else moves it on
      // to the first vehicle photo, or leaves no hero; tagging a photo a vehicle claims an empty hero.
      const heroPhoto = wasHero && role !== 'vehicle'
        ? attachedPhotos.find((x) => (x.role ?? 'vehicle') === 'vehicle')
        : !cur.heroPhoto && role === 'vehicle'
          ? attachedPhotos.find((x) => x.storagePath === ph.storagePath)
          : cur.heroPhoto;
      return {
        attachedPhotos,
        heroPhoto,
        reference: creative ? { image: creative, intent: cur.reference?.intent ?? 'recreate', changes: cur.reference?.changes } : undefined,
      };
    });

  return (
    <div className="editor-page ip-page">
      {error && (
        <Banner kind="bad">
          {error}{' '}
          <button type="button" className="btn ghost small" onClick={clearError}>Dismiss</button>
        </Banner>
      )}
      <div className="intake">
        <div className="intake-head">
          <h2>What are we making?</h2>
          <button type="button" className="btn ghost small" onClick={onSkip}>Skip to the workspace</button>
        </div>
        <Field label="Client">
          <select value={p.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value || undefined, carId: undefined, heroPhoto: undefined })} disabled={readOnly}>
            <option value="">Pick a client</option>
            {clients.map((c) => (<option key={c.id} value={c.id}>{c.displayName || c.name}</option>))}
          </select>
        </Field>
        <Field label="The brief" hint="In your words — “Delivery creative for the customers attached” or “Diwali offer on the Creta, benefits up to ₹50,000”.">
          <textarea rows={3} value={p.prompt} onChange={(e) => set({ prompt: e.target.value })} readOnly={readOnly} placeholder="Delivery creative for the customers attached" />
        </Field>
        <div className="intake-photos">
          {(p.attachedPhotos ?? []).map((ph) => (
            <div key={ph.storagePath} className="intake-photo">
              <img src={refUrl(ph.storagePath)} alt={ph.label || 'Attached image'} loading="lazy" crossOrigin="anonymous" />
              {read && (
                <select value={ph.role ?? 'vehicle'} onChange={(e) => setRole(ph, e.target.value as ImageRole)} aria-label="What this image is" disabled={readOnly}>
                  {ROLE_ORDER.map((r) => (<option key={r} value={r}>{ROLE_LABEL[r]}</option>))}
                </select>
              )}
            </div>
          ))}
          {!readOnly && (
            <ImageUpload label="Reference image" kind="car-model" buttonText="Attach images"
              onUploaded={(img) => set((cur) => ({ attachedPhotos: [...(cur.attachedPhotos ?? []), img], ...(cur.heroPhoto ? {} : { heroPhoto: img }) }))} />
          )}
        </div>
        <div className="ip-actions">
          <button type="button" className="btn primary" disabled={!canRead} onClick={() => void onUnderstand()}>
            {understanding ? 'Reading…' : read ? 'Read it again' : 'Read the brief'}
          </button>
          <span className="hint">One cheap read (about ₹1) before anything is paid for.</span>
        </div>

        {read && (
          <div className="intake-plan">
            <div className="ip-engine">
              <span className="ip-label">Kind of post</span>
              <span className="chip on">{engine.label}</span>
              {second && (<><span className="ip-plus">+</span><span className="chip on">{second.label}</span><span className="hint">{p.engine?.ratio}</span></>)}
              {p.intake?.fallback ? <span className="hint">read without the model</span> : p.intake?.confidence === 'low' ? <span className="hint">not sure — check it</span> : null}
            </div>
            {p.intake!.heard.length > 0 && <p className="hint">Heard: {p.intake!.heard.map((h) => `“${h}”`).join(', ')}</p>}
            <div className="row2">
              <Field label="Lead">
                <select value={engine.id} onChange={(e) => set({ engine: { primary: e.target.value as CreativeEngineId, secondary: p.engine?.secondary === e.target.value ? undefined : p.engine?.secondary, ratio: p.engine?.ratio, manual: true } })} disabled={readOnly}>
                  {CREATIVE_ENGINES.map((x) => (<option key={x.id} value={x.id}>{x.code} · {x.label}</option>))}
                </select>
              </Field>
              <Field label="Vehicle">
                <select value={p.carId ?? ''} onChange={(e) => onPickVehicle(e.target.value || undefined)} disabled={readOnly}>
                  <option value="">{(p.attachedPhotos ?? []).some((x) => x.role === 'vehicle' || x.role === 'moment') ? 'From the photograph' : 'No particular vehicle'}</option>
                  {vehicleChoices.map((c) => (<option key={c.id} value={c.id}>{c.brand} {c.model}</option>))}
                </select>
              </Field>
            </div>
            {fields.map((f) => {
              const v = factValue(f.id);
              const need = engine.mandatory.includes(f.id);
              return (
                <Field key={f.id} label={`${f.label}${need ? ' *' : ''}`} hint={f.hint}>
                  {f.type === 'select' ? (
                    <select value={v} onChange={(e) => set((cur) => ({ facts: { ...cur.facts, [f.id]: e.target.value } }))} disabled={readOnly}>
                      <option value="">Pick one</option>
                      {(f.options ?? []).map((o) => (<option key={o} value={o}>{o}</option>))}
                    </select>
                  ) : f.type === 'list' || f.type === 'textarea' ? (
                    <textarea rows={3} value={v} placeholder={f.placeholder} onChange={(e) => set((cur) => ({ facts: { ...cur.facts, [f.id]: e.target.value } }))} readOnly={readOnly} />
                  ) : (
                    <input value={v} placeholder={f.placeholder} onChange={(e) => set((cur) => ({ facts: { ...cur.facts, [f.id]: e.target.value } }))} readOnly={readOnly} />
                  )}
                </Field>
              );
            })}
            {p.reference && (
              <div className="row2">
                <Field label="The attached creative">
                  <select value={p.reference.intent} onChange={(e) => set((cur) => ({ reference: cur.reference ? { ...cur.reference, intent: e.target.value as ReferenceIntent } : undefined }))} disabled={readOnly}>
                    {(Object.keys(INTENT_LABEL) as ReferenceIntent[]).map((i) => (<option key={i} value={i}>{INTENT_LABEL[i]}</option>))}
                  </select>
                </Field>
                <Field label="What changes" hint="Only with “Change elements”.">
                  <input value={p.reference.changes ?? ''} onChange={(e) => set((cur) => ({ reference: cur.reference ? { ...cur.reference, changes: e.target.value || undefined } : undefined }))} readOnly={readOnly} />
                </Field>
              </div>
            )}
            {(p.attachedPhotos ?? []).some((x) => x.role === 'logo') && (
              <p className="hint">A logo travels with the client, not the project — add it in Clients; this one is left out of the creative.</p>
            )}
            <Field label="Sizes">
              <div className="intake-sizes">
                {CREATIVE_FORMATS.map((f) => {
                  const on = p.formats.includes(f.id);
                  return (
                    <label key={f.id} className={`chip${on ? ' on' : ''}`}>
                      <input type="checkbox" checked={on} disabled={readOnly}
                        onChange={(e) => set((cur) => ({ formats: e.target.checked ? CREATIVE_FORMATS.map((x) => x.id).filter((id) => id === f.id || cur.formats.includes(id)) : cur.formats.filter((id) => id !== f.id) }))} />
                      {f.label}
                    </label>
                  );
                })}
              </div>
            </Field>
            <div className="row2">
              <Field label="Words on the picture in">
                <select value={p.languageId ?? 'en'} onChange={(e) => set({ languageId: e.target.value })} disabled={readOnly}>
                  {languageChoices.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
                </select>
              </Field>
            </div>
            {missing.length > 0 && <p className="hint ip-blocked">{missing.map((id) => engine.fields.find((f) => f.id === id)?.label ?? id).join(', ')} still to fill — the proof needs {missing.length === 1 ? 'it' : 'them'}.</p>}
            {!hasPhoto && <p className="hint ip-blocked">Attach a photo above, or skip to the workspace and pick one from the library — the proof is built from a real photo, never an imagined one.</p>}
            <div className="ip-actions">
              {sizesIntent ? (
                <button type="button" className="btn primary" disabled={!canProve || !p.formats.length} onClick={() => void onAllSizes()}>
                  {busy === 'design' ? 'Making…' : `Make the ${sizesTodo} size${sizesTodo === 1 ? '' : 's'} · ${allCost}`}
                </button>
              ) : (
                <button type="button" className="btn primary" disabled={!canProve} onClick={() => void onProof()}>
                  {proofState === 'working' || busy !== '' ? 'Making the proof…' : 'Make the proof · 1:1 · about ₹10'}
                </button>
              )}
              <span className="hint">{sizesIntent ? 'The attached creative is the master — every size is made in its image.' : 'One square first; the rest only when it is right.'}</span>
            </div>
          </div>
        )}

        {proof && !sizesIntent && (
          <div className="intake-proof">
            <img src={refUrl(proof.image.storagePath)} alt="The proof creative" crossOrigin="anonymous" />
            <div className="intake-proof-side">
              <span className={`ip-check ${proof.checks.words.checked ? (proof.checks.words.ok ? 'ok' : 'bad') : ''}`}>
                {proof.checks.words.checked ? (proof.checks.words.ok ? 'Words ✓' : 'Words to check') : 'Words not checked'}
              </span>
              <span className={`ip-check ${proof.checks.vehicle.checked ? (proof.checks.vehicle.same ? 'ok' : 'bad') : ''}`}>
                {proof.checks.vehicle.checked ? (proof.checks.vehicle.same ? 'Same vehicle ✓' : 'Vehicle may differ') : 'Vehicle not checked'}
              </span>
              {sizesTodo ? (
                <button type="button" className="btn primary" disabled={busy !== '' || proofState === 'working'} onClick={() => void onAllSizes()}>
                  {busy === 'design' ? 'Making…' : `Looks right — make all sizes · ${allCost}`}
                </button>
              ) : (
                <button type="button" className="btn primary" onClick={onSkip}>
                  Every size is made — to the workspace
                </button>
              )}
              <form className="ip-ask" onSubmit={(e) => { e.preventDefault(); if (change.trim()) { void onRevise(change.trim()); setChange(''); } }}>
                <input value={change} onChange={(e) => setChange(e.target.value)} placeholder="Ask for a change — “make the headline gold”" maxLength={400} />
                <button type="submit" className="btn small" disabled={!change.trim() || proofState === 'working' || busy !== ''}>Ask</button>
              </form>
              <button type="button" className="btn ghost small" disabled={busy !== '' || proofState === 'working'} onClick={() => void onProof()}>Make it again</button>
            </div>
          </div>
        )}
        {proofState === 'failed' && <p className="hint ip-blocked">The proof failed — the error above says why. Fix it and try again.</p>}
      </div>
    </div>
  );
}
