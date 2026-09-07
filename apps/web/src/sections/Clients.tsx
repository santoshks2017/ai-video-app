import { useState } from 'react';
import type { ClientProfile, StoredImage } from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, PickList, ImageUpload, Thumb, Confirm, Empty, Banner } from '../components/ui.js';
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

  const set = (p: Partial<ClientProfile>) => setDraft((d) => (d ? { ...d, ...p } : d));

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
    set({
      name: draft.name.trim() || r.name,
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
          Dealers you make videos for. Name, contact and showroom photos flow into every project tagged to this
          client — the footer bar, end card and reference images are all derived from here.
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
                {[c.brand, c.city, `${c.photos.length} photo${c.photos.length === 1 ? '' : 's'}`]
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

          <div className="row2">
            <Field label="Client / showroom name">
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Sterling Hyundai" />
            </Field>
            <Field label="Brand">
              <input value={draft.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="e.g. Hyundai" />
            </Field>
          </div>
          <div className="row2">
            <Field label="City">
              <input value={draft.city ?? ''} onChange={(e) => set({ city: e.target.value })} placeholder="e.g. Jaipur" />
            </Field>
            <Field label="Phone">
              <input value={draft.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} placeholder="98765 43210" />
            </Field>
          </div>
          <Field label="Address">
            <input value={draft.address ?? ''} onChange={(e) => set({ address: e.target.value })} placeholder="MG Road" />
          </Field>
          <Field label="Dealer tier" hint="Sets the copy tone on generated cards.">
            <select value={draft.tier} onChange={(e) => set({ tier: e.target.value as ClientProfile['tier'] })}>
              <option value="Metro Premium">Metro Premium (long, narrative)</option>
              <option value="Regional/Volume">Regional / Volume (offer-forward)</option>
              <option value="Hyperlocal">Hyperlocal (short, minimal)</option>
            </select>
          </Field>

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
            <div className="row2">
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

          <div className="row2">
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

          <Field label="Showroom photos" hint="Used as visual references so generations match the real showroom.">
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
          </Field>

          <Field label="Notes">
            <textarea value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
          </Field>

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
