import { useRef, useState, type ReactNode } from 'react';
import {
  CATEGORIES,
  NARRATION,
  formatFit,
  formatFitSummary,
  type CategoryId,
  type DealerPhoto,
} from '@ava/shared';
import { useBrief } from '../state/briefStore.js';
import { api, isApiError } from '../lib/api.js';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function Card({ n, title, step, children }: { n: number; title: string; step: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className="head">
        <h2>
          {n}. {title}
        </h2>
        <span className="step">{step}</span>
      </div>
      <div className="body">{children}</div>
    </div>
  );
}

export function BriefForm() {
  const {
    brief,
    set,
    setDealer,
    setActor,
    toggleCategory,
    setFieldValue,
    prefillCategory,
    addAttachment,
    removeAttachment,
  } = useBrief();

  const fit = formatFit(brief.durationSec, brief.aspect);

  return (
    <>
      <Card n={1} title="Video categories" step="Composable — pick 1 or more">
        <div className="section-desc">
          The 5 automated categories call the video-gen API. Selecting any presenter category makes the whole
          brief prompt-only (no API call, no cost) — same intake, storyboard and pre-flight.
        </div>
        <div className="cat-grid">
          {CATEGORIES.map((c) => {
            const on = brief.categories.includes(c.id);
            return (
              <div key={c.id} className={`cat${on ? ' on' : ''}`} onClick={() => toggleCategory(c.id)}>
                <span className="m">{c.mode === 'automated' ? 'Automated' : 'Prompt-only'}</span>
                <span className="n">{c.label}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card n={2} title="Format & narration" step="Sets the whole prompt">
        <div className="row2">
          <Field label="Narration mode" hint={NARRATION[brief.narration].hint}>
            <select
              value={brief.narration}
              onChange={(e) => set({ narration: e.target.value as typeof brief.narration })}
            >
              {Object.values(NARRATION).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Music / audio bed" hint="Blank → the prompt asks for a neutral commercial track.">
            <input
              value={brief.music}
              onChange={(e) => set({ music: e.target.value })}
              placeholder="e.g. upbeat modern commercial track, low under the voice"
            />
          </Field>
        </div>
        <div className="row3">
          <Field label="Total duration (seconds)">
            <input
              type="number"
              min={6}
              max={120}
              value={brief.durationSec}
              onChange={(e) => set({ durationSec: Number(e.target.value) })}
            />
          </Field>
          <Field label="Max seconds per generation" hint="Omni Flash: 3–10s per clip. Longer videos split into create-then-extend parts.">
            <input
              type="number"
              min={3}
              max={30}
              value={brief.maxChunkSec}
              onChange={(e) => set({ maxChunkSec: Number(e.target.value) })}
            />
          </Field>
          <Field label="Aspect ratio">
            <select value={brief.aspect} onChange={(e) => set({ aspect: e.target.value as typeof brief.aspect })}>
              <option value="9:16">Vertical 9:16</option>
              <option value="1:1">Square 1:1</option>
              <option value="16:9">Horizontal 16:9</option>
            </select>
          </Field>
        </div>
        <div className="row2">
          <Field label="Resolution" hint="Omni Flash is 720p-only in v1 — this is informational.">
            <select
              value={brief.resolution}
              onChange={(e) => set({ resolution: e.target.value as typeof brief.resolution })}
            >
              <option value="720p">720p</option>
              <option value="480p">480p</option>
            </select>
          </Field>
          <Field label="Social formats" hint={fit.notes.join(' ')}>
            <input readOnly value={formatFitSummary(fit)} />
          </Field>
        </div>
        <div className="check-row">
          <input
            type="checkbox"
            id="modelSpecific"
            checked={brief.modelSpecific}
            onChange={(e) => set({ modelSpecific: e.target.checked })}
          />
          <label htmlFor="modelSpecific">Model-specific — references a particular car model</label>
        </div>
        {brief.modelSpecific && (
          <>
            <Field
              label="Car model"
              hint="Fetches a current reference-image set from CarDekho so the model isn't left to invent an outdated design."
            >
              <input
                value={brief.carModel ?? ''}
                onChange={(e) => set({ carModel: e.target.value })}
                placeholder="e.g. Hyundai Creta"
              />
            </Field>
            <CarModelFetch model={brief.carModel ?? ''} onAdd={addAttachment} />
          </>
        )}
      </Card>

      <Card n={3} title="Dealer & branding" step="Drives footer + end card">
        <div className="row2">
          <Field label="Dealer / showroom name">
            <input
              value={brief.dealer.dealerName}
              onChange={(e) => setDealer({ dealerName: e.target.value })}
              placeholder="e.g. Jasper Tata"
            />
          </Field>
          <Field label="Brand + model">
            <input
              value={brief.dealer.brandModel}
              onChange={(e) => setDealer({ brandModel: e.target.value })}
              placeholder="e.g. Tata Safari"
            />
          </Field>
        </div>
        <div className="row2">
          <Field label="Phone">
            <input
              value={brief.dealer.phone ?? ''}
              onChange={(e) => setDealer({ phone: e.target.value })}
              placeholder="+91 98765 43210"
            />
          </Field>
          <Field label="Dealer tier">
            <select
              value={brief.dealer.tier}
              onChange={(e) => setDealer({ tier: e.target.value as typeof brief.dealer.tier })}
            >
              <option value="Metro Premium">Metro Premium (long, narrative tone)</option>
              <option value="Regional/Volume">Regional / Volume (structured, offer-forward)</option>
              <option value="Hyperlocal">Hyperlocal (short, minimalist)</option>
            </select>
          </Field>
        </div>
        <Field label="Address / locations (for footer)">
          <input
            value={brief.dealer.address ?? ''}
            onChange={(e) => setDealer({ address: e.target.value })}
            placeholder="e.g. City Centre | North Point | Riverside"
          />
        </Field>
        <div className="check-row">
          <input
            type="checkbox"
            id="fict"
            checked={brief.dealer.fictionalize}
            onChange={(e) => setDealer({ fictionalize: e.target.checked })}
          />
          <label htmlFor="fict">Fictionalize brand/dealer names in the prompt (recommended)</label>
        </div>
        <div className="hint" style={{ margin: '-4px 0 10px' }}>
          Video models render real OEM logos badly and often refuse trademarked branding. Your real details still
          drive the footer and end card.
        </div>
        {brief.dealer.fictionalize && (
          <div className="row2">
            <Field label="Placeholder brand + model">
              <input
                value={brief.dealer.fakeBrandModel ?? ''}
                onChange={(e) => setDealer({ fakeBrandModel: e.target.value })}
                placeholder="e.g. BYTE VANTA X"
              />
            </Field>
            <Field label="Placeholder dealership name">
              <input
                value={brief.dealer.fakeDealer ?? ''}
                onChange={(e) => setDealer({ fakeDealer: e.target.value })}
                placeholder="e.g. Byte Premier Motors"
              />
            </Field>
          </div>
        )}
      </Card>

      <Card n={4} title="Actor / promoter" step="Used when someone is on camera">
        <div className="row2">
          <Field label="Name / label">
            <input
              value={brief.actor.name}
              onChange={(e) => setActor({ name: e.target.value })}
              placeholder="e.g. Meera — Metro Premium promoter"
            />
          </Field>
          <Field label="Gender" hint="Locks the Hindi verb forms in the rulebook.">
            <select
              value={brief.actor.gender}
              onChange={(e) => setActor({ gender: e.target.value as typeof brief.actor.gender })}
            >
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </Field>
        </div>
        <div className="row2">
          <Field label="Age range">
            <input
              value={brief.actor.age ?? ''}
              onChange={(e) => setActor({ age: e.target.value })}
              placeholder="e.g. late 20s"
            />
          </Field>
          <Field label="Voice / delivery notes">
            <input
              value={brief.actor.voice ?? ''}
              onChange={(e) => setActor({ voice: e.target.value })}
              placeholder="e.g. warm, energetic, confident dealership-ad pace"
            />
          </Field>
        </div>
        <Field label="Styling / look">
          <textarea
            value={brief.actor.style ?? ''}
            onChange={(e) => setActor({ style: e.target.value })}
            placeholder="e.g. fitted maroon polo dress, nude heels, subtle jewellery"
          />
        </Field>
      </Card>

      <AttachmentsCard
        attachments={brief.attachments}
        onAdd={addAttachment}
        onRemove={removeAttachment}
      />

      <Card n={6} title="On-screen text & end card" step="Rendered in the video">
        <div className="section-desc">
          Everything here is repeated in the prompt as an exact-spelling lock — keep each line short.
        </div>
        <div className="row2">
          <Field label="On-screen text language">
            <select
              value={brief.textLang}
              onChange={(e) => set({ textLang: e.target.value as typeof brief.textLang })}
            >
              <option value="english">English only</option>
              <option value="mixed">Hindi + English mixed</option>
              <option value="hindi">Devanagari-led</option>
            </select>
          </Field>
          <Field label="Caption / copy style">
            <select
              value={brief.captionStyle}
              onChange={(e) => set({ captionStyle: e.target.value as typeof brief.captionStyle })}
            >
              <option value="Long Narrative">Long Narrative (Metro Premium)</option>
              <option value="Short Punchy">Short Punchy (Regional/Volume)</option>
              <option value="Structured">Structured minimal (Hyperlocal)</option>
            </select>
          </Field>
        </div>
        <Field label="Persistent footer bar text" hint="Blank → derived from dealer name + address + phone.">
          <input
            value={brief.footer}
            onChange={(e) => set({ footer: e.target.value })}
            placeholder="e.g. Jasper Tata | Model Town | 98765 43210"
          />
        </Field>
        <div className="row2">
          <Field label="Primary CTA">
            <input value={brief.cta} onChange={(e) => set({ cta: e.target.value })} />
          </Field>
          <Field label="Visual style">
            <input value={brief.visualStyle} onChange={(e) => set({ visualStyle: e.target.value })} />
          </Field>
        </div>
        <div className="check-row">
          <input
            type="checkbox"
            id="endcard"
            checked={brief.endCardOn}
            onChange={(e) => set({ endCardOn: e.target.checked })}
          />
          <label htmlFor="endcard">Include a closing end card</label>
        </div>
        {brief.endCardOn && (
          <Field label="End card content" hint="One line per row, or separate with |.">
            <textarea
              value={brief.endCard}
              onChange={(e) => set({ endCard: e.target.value })}
              placeholder="e.g. Jasper Tata | Book your Safari test drive today | Model Town | 98765 43210"
            />
          </Field>
        )}
      </Card>

      {brief.categories.length > 0 && (
        <Card n={7} title="Category details" step="Shown for selected categories">
          {brief.categories.map((id) => (
            <CategoryFields
              key={id}
              id={id}
              values={brief.fieldValues[id] ?? {}}
              onChange={setFieldValue}
              onPrefill={prefillCategory}
            />
          ))}
        </Card>
      )}
    </>
  );
}

function AttachmentsCard({
  attachments,
  onAdd,
  onRemove,
}: {
  attachments: DealerPhoto[];
  onAdd: (a: DealerPhoto) => void;
  onRemove: (filename: string) => void;
}) {
  return (
    <Card n={5} title="Reference images" step="Grounded into the generation">
      <div className="section-desc">
        Upload dealer photos, a logo, or car-model shots. Each needs a short label. On an automated generation
        the uploaded images are passed to Omni Flash as visual references (P0.4) so it uses the real showroom /
        car instead of inventing one. For prompt-only categories they're cited by filename in the master prompt.
      </div>
      <AttachmentAdder onAdd={onAdd} />
      {attachments.length === 0 ? (
        <div className="hint">No reference images uploaded.</div>
      ) : (
        attachments.map((a) => (
          <div className="attach-item" key={a.filename}>
            {a.src && <img src={a.src} alt={a.label} />}
            <div className="a-meta" style={{ flex: 1 }}>
              <b>
                <code>{a.filename}</code>
              </b>
              <span>
                {a.label} · {a.kind}
                {a.storagePath ? '' : ' · not uploaded'}
              </span>
            </div>
            <button className="btn ghost small" onClick={() => onRemove(a.filename)}>
              Remove
            </button>
          </div>
        ))
      )}
    </Card>
  );
}

function AttachmentAdder({ onAdd }: { onAdd: (a: DealerPhoto) => void }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<DealerPhoto['kind']>('dealer');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const l = label.trim();
    if (!l) {
      setErr('Add a label first.');
      return;
    }
    setBusy(true);
    setErr('');
    const r = await api.uploadRef(file, l, kind);
    setBusy(false);
    if (isApiError(r)) {
      setErr(`${r.code}: ${r.message}`);
      return;
    }
    onAdd(r);
    setLabel('');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div className="row3" style={{ alignItems: 'end' }}>
        <Field label="Label (what it shows)">
          <input
            value={label}
            placeholder="e.g. Showroom front exterior"
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as DealerPhoto['kind'])}>
            <option value="dealer">Dealer photo</option>
            <option value="car-model">Car model</option>
            <option value="logo">Logo</option>
          </select>
        </Field>
        <button className="btn small" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Uploading…' : 'Upload image'}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {err && <div className="hint" style={{ color: 'var(--bad)' }}>{err}</div>}
    </div>
  );
}

function CarModelFetch({ model, onAdd }: { model: string; onAdd: (a: DealerPhoto) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const go = async () => {
    if (!model.trim()) {
      setMsg('Enter a car model first.');
      return;
    }
    setBusy(true);
    setMsg('');
    const r = await api.scrapeCarModel(model.trim());
    setBusy(false);
    if (isApiError(r)) {
      setMsg(r.message);
      return;
    }
    r.forEach(onAdd);
    setMsg(`Added ${r.length} reference image${r.length > 1 ? 's' : ''} (${[...new Set(r.map((x) => x.label.split('— ')[1]))].join(', ')}).`);
  };
  return (
    <div style={{ marginTop: -4, marginBottom: 8 }}>
      <button className="btn small" disabled={busy} onClick={go}>
        {busy ? 'Fetching from CarDekho…' : 'Fetch reference images from CarDekho'}
      </button>
      {msg && <div className="hint">{msg}</div>}
    </div>
  );
}

function CategoryFields({
  id,
  values,
  onChange,
  onPrefill,
}: {
  id: CategoryId;
  values: Record<string, string>;
  onChange: (cat: CategoryId, field: string, value: string) => void;
  onPrefill: (cat: CategoryId) => void;
}) {
  const cat = CATEGORIES.find((c) => c.id === id)!;
  const mandatoryIds = new Set(cat.mandatory.map((m) => m.id));
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ marginBottom: 8 }}>{cat.label}</h3>
        <button
          className="btn ghost small"
          type="button"
          onClick={() => onPrefill(id)}
          title="Fill this category's fields with sample data (and any blank dealer/actor essentials). Manual — only on click."
        >
          Use prefill sample data
        </button>
      </div>
      <div className="hint" style={{ marginBottom: 10 }}>
        {cat.purpose}
      </div>
      {cat.fields.map((fld) => {
        if (fld.showIf && !values[fld.showIf]) return null;
        const label = `${fld.label}${mandatoryIds.has(fld.id) ? ' *' : ''}`;
        if (fld.type === 'checkbox') {
          return (
            <div className="check-row" key={fld.id}>
              <input
                type="checkbox"
                id={`${id}_${fld.id}`}
                checked={!!values[fld.id]}
                onChange={(e) => onChange(id, fld.id, e.target.checked ? 'yes' : '')}
              />
              <label htmlFor={`${id}_${fld.id}`}>{fld.label}</label>
            </div>
          );
        }
        return (
          <Field key={fld.id} label={label}>
            {fld.type === 'textarea' ? (
              <textarea
                value={values[fld.id] ?? ''}
                placeholder={fld.ph}
                onChange={(e) => onChange(id, fld.id, e.target.value)}
              />
            ) : fld.type === 'select' ? (
              <select value={values[fld.id] ?? ''} onChange={(e) => onChange(id, fld.id, e.target.value)}>
                <option value="">Select…</option>
                {(fld.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={values[fld.id] ?? ''}
                placeholder={fld.ph}
                onChange={(e) => onChange(id, fld.id, e.target.value)}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}
