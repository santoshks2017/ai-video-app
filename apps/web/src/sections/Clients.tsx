import { useMemo, useState } from 'react';
import {
  suggestDisplayName,
  defaultFooterText,
  type ClientProfile,
  type StoredImage,
} from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, Section, PickList, ImageUpload, Thumb, Confirm, Empty, Banner } from '../components/ui.js';
import { isApiError, post, abs } from '../lib/client.js';

function blank(): ClientProfile {
  const now = Date.now();
  return {
    id: '',
    name: '',
    brand: '',
    tier: 'Metro Premium',
    photos: [],
    fictionalize: true,
    createdAt: now,
    updatedAt: now,
  };
}

interface GmbResult {
  placeId: string;
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  city?: string;
  photos: StoredImage[];
  note?: string;
}

export function ClientsSection() {
  const clients = useApp((s) => s.clients);
  const refresh = useApp((s) => s.refresh);
  const [draft, setDraft] = useState<ClientProfile | null>(null);
  const [err, setErr] = useState('');
  const [gmbInput, setGmbInput] = useState('');
  const [gmbBusy, setGmbBusy] = useState(false);
  const [gmbNote, setGmbNote] = useState('');
  const [brandDraft, setBrandDraft] = useState('');

  const set = (p: Partial<ClientProfile>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const cars = useApp((s) => s.cars);
  /** Brands that exist in the vehicle library, so the picker only offers what can be filmed. */
  const libraryBrands = useMemo(
    () => [...new Set(cars.map((c) => c.brand.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [cars],
  );
  const brands = draft?.brands?.length ? draft.brands : draft?.brand ? [draft.brand] : [];
  const extraBrands = brands.filter((b) => !libraryBrands.includes(b));
  // The first brand is the main one: it is what the films lead with.
  const setBrands = (next: string[]) => set({ brands: next, brand: next[0] ?? '' });
  const toggleBrand = (b: string) => setBrands(brands.includes(b) ? brands.filter((x) => x !== b) : [...brands, b]);
  const addBrand = () => {
    const b = brandDraft.trim();
    if (b && !brands.some((x) => x.toLowerCase() === b.toLowerCase())) setBrands([...brands, b]);
    setBrandDraft('');
  };

  const save = async () => {
    if (!draft?.name.trim()) {
      setErr('Client name is required.');
      return;
    }
    setErr('');
    const r = await api.clients.save(draft);
    if (isApiError(r)) {
      setErr(r.message);
      return;
    }
    await refresh();
    setDraft(r);
  };

  const importGmb = async () => {
    const q = gmbInput.trim();
    if (!q || !draft) return;
    setGmbBusy(true);
    setGmbNote('');
    const isUrl = /^https?:\/\//i.test(q);
    const r = await post<GmbResult>('/api/clients/gmb', isUrl ? { url: q } : { query: q });
    setGmbBusy(false);
    if (isApiError(r)) {
      setGmbNote(r.message);
      return;
    }
    const photos = r.photos.map((p) => ({ ...p, url: abs(p.url ?? null) ?? p.url }));
    const importedName = draft.name.trim() || r.name;
    set({
      name: importedName,
      displayName: draft.displayName?.trim() || suggestDisplayName(importedName),
      address: r.address ?? draft.address,
      phone: r.phone ?? draft.phone,
      city: r.city ?? draft.city,
      gmbPlaceId: r.placeId,
      gmbUrl: isUrl ? q : draft.gmbUrl,
      gmbSyncedAt: Date.now(),
      photos: [...draft.photos, ...(photos as StoredImage[])],
    });
    setGmbNote(
      r.note ?? `Imported ${r.name}${r.photos.length ? ` and ${r.photos.length} photos` : ''}. Review, then Save.`,
    );
  };

  return (
    <div className="grid two">
      <Panel
        title="Clients"
        step={`${clients.length} saved`}
        actions={
          <button className="btn small" type="button" onClick={() => { setDraft(blank()); setGmbNote(''); setGmbInput(''); }}>
            New client
          </button>
        }
      >
        <div className="section-desc">
          Dealers you make videos for. The footer bar, end card and reference images of every project tagged to a
          client come from here.
        </div>
        <PickList
          items={clients}
          activeId={draft?.id ?? null}
          onPick={(id) => { setDraft(clients.find((c) => c.id === id) ?? null); setGmbNote(''); }}
          emptyText="No clients yet."
          render={(c) => (
            <>
              <b>{c.name}</b>
              <span>
                {[c.displayName && c.displayName !== c.name ? `“${c.displayName}”` : null, c.brand, c.city]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </>
          )}
        />
      </Panel>

      {draft ? (
        <Panel
          title={draft.id ? 'Edit client' : 'New client'}
          actions={
            draft.id ? (
              <Confirm
                onConfirm={async () => {
                  await api.clients.remove(draft.id);
                  setDraft(null);
                  await refresh();
                }}
              >
                Delete
              </Confirm>
            ) : undefined
          }
        >
          {err && <Banner kind="bad">{err}</Banner>}

          <Field
            label="Import from Google Business Profile"
            hint="Paste the Google Maps link for the showroom, or type “Dealer name, city”. Pulls address, phone and photos."
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={gmbInput}
                onChange={(e) => setGmbInput(e.target.value)}
                placeholder="https://maps.google.com/… or Sterling Hyundai, Jaipur"
              />
              <button className="btn small" type="button" disabled={gmbBusy || !gmbInput.trim()} onClick={importGmb}>
                {gmbBusy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </Field>
          {gmbNote && <div className="hint" style={{ marginTop: -6, marginBottom: 10 }}>{gmbNote}</div>}

          <div className="divider" />

          <div className="field-grid">
            <Field label="Client / showroom name" hint="Full name, as on the Google listing.">
              <input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Sterling Hyundai"
              />
            </Field>
            <Field
              label="Display name"
              hint="The short name shown on screen. A full legal name won't fit."
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={draft.displayName ?? ''}
                  onChange={(e) => set({ displayName: e.target.value })}
                  placeholder={suggestDisplayName(draft.name) || 'e.g. Jasper Cars'}
                />
                {draft.name && suggestDisplayName(draft.name) !== draft.displayName && (
                  <button
                    className="btn small"
                    type="button"
                    onClick={() => set({ displayName: suggestDisplayName(draft.name) })}
                  >
                    Use “{suggestDisplayName(draft.name)}”
                  </button>
                )}
              </div>
            </Field>
            <Field label="Sells" hint="Honda, Suzuki and Hero badge both — a car showroom set to bikes comes back full of motorcycles.">
              <select
                value={draft.vehicleKind ?? 'car'}
                onChange={(e) => set({ vehicleKind: e.target.value as 'car' | 'bike' })}
              >
                <option value="car">Cars</option>
                <option value="bike">Bikes &amp; scooters</option>
              </select>
            </Field>
            <Field label="City">
              <input value={draft.city ?? ''} onChange={(e) => set({ city: e.target.value })} placeholder="e.g. Jaipur" />
            </Field>
            <Field label="Phone">
              <input value={draft.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} placeholder="98765 43210" />
            </Field>
            <Field label="Address">
              <input value={draft.address ?? ''} onChange={(e) => set({ address: e.target.value })} placeholder="MG Road" />
            </Field>
            <div className="span">
              <Field
                label="Brands"
                hint="What this dealer sells, from your vehicle library. Pick more than one for a group — the first is what films lead with."
              >
                <div className="brandgrid">
                  {libraryBrands.map((b) => (
                    <button
                      key={b}
                      type="button"
                      className={`brandchip${brands.includes(b) ? ' on' : ''}`}
                      onClick={() => toggleBrand(b)}
                    >
                      {b}
                    </button>
                  ))}
                  {extraBrands.map((b) => (
                    <button key={b} type="button" className="brandchip on" onClick={() => toggleBrand(b)}>
                      {b}
                    </button>
                  ))}
                </div>
                {libraryBrands.length === 0 && (
                  <div className="hint">
                    No vehicles synced yet — sync a brand in Vehicles, or type one in below.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <input
                    value={brandDraft}
                    onChange={(e) => setBrandDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addBrand();
                      }
                    }}
                    placeholder="A brand not in the library yet"
                  />
                  <button className="btn small" type="button" disabled={!brandDraft.trim()} onClick={addBrand}>
                    Add
                  </button>
                </div>
              </Field>
            </div>
          </div>
          <div className="sec-stack">
            <Section sub title="On-screen branding" step="Footer, tone, logos" defaultOpen>
              <Field
                label="Footer strip"
                hint="Burned across the bottom of every video for this client. Overlaid after generation, so keep it short."
              >
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={draft.footerText ?? ''}
                    onChange={(e) => set({ footerText: e.target.value })}
                    placeholder={defaultFooterText(draft)}
                  />
                  {defaultFooterText(draft) && defaultFooterText(draft) !== draft.footerText && (
                    <button
                      className="btn small"
                      type="button"
                      onClick={() => set({ footerText: defaultFooterText(draft) })}
                    >
                      Suggest
                    </button>
                  )}
                </div>
                <div className="footer-preview">{draft.footerText?.trim() || defaultFooterText(draft) || '—'}</div>
              </Field>

              <Field label="Dealer tier" hint="Sets the copy tone on generated cards.">
                <select value={draft.tier} onChange={(e) => set({ tier: e.target.value as ClientProfile['tier'] })}>
                  <option value="Metro Premium">Metro Premium (long, narrative)</option>
                  <option value="Regional/Volume">Regional / Volume (offer-forward)</option>
                  <option value="Hyperlocal">Hyperlocal (short, minimal)</option>
                </select>
              </Field>

              <div className="field-grid">
                <Field
                  label="Dealership logo"
                  hint="Overlaid top-right on every video. Use a transparent PNG."
                >
                  <div className="thumbs">
                    {draft.logo && <Thumb img={draft.logo} onRemove={() => set({ logo: undefined })} />}
                    <ImageUpload
                      label={`${draft.name || 'Client'} — dealership logo`}
                      kind="logo"
                      buttonText={draft.logo ? 'Replace' : 'Upload'}
                      onUploaded={(img) => set({ logo: img })}
                    />
                  </div>
                </Field>
                <Field label="Brand logo" hint="Overlaid top-left. Transparent PNG.">
                  <div className="thumbs">
                    {draft.brandLogo && (
                      <Thumb img={draft.brandLogo} onRemove={() => set({ brandLogo: undefined })} />
                    )}
                    <ImageUpload
                      label={`${draft.brand || 'Brand'} — brand logo`}
                      kind="brand-logo"
                      buttonText={draft.brandLogo ? 'Replace' : 'Upload'}
                      onUploaded={(img) => set({ brandLogo: img })}
                    />
                  </div>
                </Field>
              </div>
            </Section>

            <Section
              sub
              title="Showroom photos"
              step={draft.photos.length ? `${draft.photos.length} in the library` : 'None yet'}
            >
              <div className="thumbs">
                {draft.photos.map((p) => (
                  <Thumb
                    key={p.refId}
                    img={p}
                    onRemove={() => set({ photos: draft.photos.filter((x) => x.refId !== p.refId) })}
                  />
                ))}
                <ImageUpload
                  label={`${draft.name || 'Client'} — showroom photo`}
                  onUploaded={(img) => set({ photos: [...draft.photos, img] })}
                  buttonText="Add photo"
                />
              </div>
              <div className="hint">Visual references, so a generation matches the real showroom.</div>
            </Section>

            <Section
              sub
              title="Fictionalised names"
              step={draft.fictionalize ? 'On — real names are replaced' : 'Off — the real names are used'}
            >
              <div className="check-row">
                <input
                  type="checkbox"
                  id="cl_fict"
                  checked={draft.fictionalize}
                  onChange={(e) => set({ fictionalize: e.target.checked })}
                />
                <label htmlFor="cl_fict">Fictionalise branding in generated videos (recommended)</label>
              </div>
              {draft.fictionalize && (
                <div className="field-grid">
                  <Field label="Placeholder brand + model">
                    <input
                      value={draft.fakeBrandModel ?? ''}
                      onChange={(e) => set({ fakeBrandModel: e.target.value })}
                      placeholder="e.g. AURA VX"
                    />
                  </Field>
                  <Field label="Placeholder dealership">
                    <input
                      value={draft.fakeDealer ?? ''}
                      onChange={(e) => set({ fakeDealer: e.target.value })}
                      placeholder="e.g. Sterling Premier Motors"
                    />
                  </Field>
                </div>
              )}
            </Section>

            <Section sub title="Notes" step={draft.notes?.trim() ? 'Has notes' : undefined}>
              <textarea value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
            </Section>
          </div>

          <div className="toolbar">
            <button className="btn primary" type="button" onClick={save}>
              Save client
            </button>
            <button className="btn ghost" type="button" onClick={() => setDraft(null)}>
              Close
            </button>
          </div>
        </Panel>
      ) : (
        <Panel title="Client details">
          <Empty icon="🏢">Pick a client on the left, or create a new one.</Empty>
        </Panel>
      )}
    </div>
  );
}
