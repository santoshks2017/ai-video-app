import { useEffect, useMemo, useState } from 'react';
import { LOGO_CLEAN_VERSION, LOGO_SLOTS, logoLayout, logosOn,
  suggestDisplayName,
  defaultFooterText,
  usualActorFor,
  CATEGORIES,
  formatInr,
  PROJECT_STAGES,
  projectStage,
  DEALER_VIEWS,
  dealerViewLabel,
  type DealerView,
  type ClientProfile,
  type StoredImage,
} from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, Section, ImageUpload, Thumb, Confirm, Empty, Banner, Lock } from '../components/ui.js';
import { isApiError, post, get, abs, buildClientSheets, cleanClientLogos } from '../lib/client.js';

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

/** Typed once, chosen after that — the states these dealerships are actually in. */
const STATES = [
  'Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra',
  'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
];

interface SiteResult {
  url: string;
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  logo?: StoredImage;
  logoWhite?: StoredImage;
  logoKind?: 'dealer' | 'brand';
  notes: string[];
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
  /** A logo the website had, held back because the client already has one. */
  const [siteLogo, setSiteLogo] = useState<null | { slot: 'dealer' | 'brand'; logo: StoredImage; white?: StoredImage }>(null);
  const [brandDraft, setBrandDraft] = useState('');
  const [sheetBusy, setSheetBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoNote, setLogoNote] = useState('');
  const [sheetNote, setSheetNote] = useState('');
  const [q, setQ] = useState('');
  const [fBrand, setFBrand] = useState('');
  const [fKind, setFKind] = useState('');
  const [fCity, setFCity] = useState('');
  const [fState, setFState] = useState('');

  const set = (p: Partial<ClientProfile>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const cars = useApp((s) => s.cars);
  const actors = useApp((s) => s.actors);
  const projects = useApp((s) => s.projects);
  const go = useApp((s) => s.go);

  const clientBrandsOf = (c: ClientProfile) => (c.brands?.length ? c.brands : [c.brand]).filter(Boolean);
  /** Every value the list can be narrowed by, taken from the clients themselves. */
  const facets = useMemo(() => {
    const uniq = (xs: (string | undefined)[]) =>
      [...new Set(xs.map((x) => (x ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return {
      brands: uniq(clients.flatMap(clientBrandsOf)),
      cities: uniq(clients.map((c) => c.city)),
      states: uniq(clients.map((c) => c.state)),
    };
  }, [clients]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clients
      .filter((c) => !fBrand || clientBrandsOf(c).some((b) => b.toLowerCase() === fBrand.toLowerCase()))
      .filter((c) => !fKind || (c.vehicleKind ?? 'car') === fKind)
      .filter((c) => !fCity || (c.city ?? '') === fCity)
      .filter((c) => !fState || (c.state ?? '') === fState)
      .filter((c) => {
        if (!needle) return true;
        return [c.name, c.displayName, c.city, c.state, c.address, c.phone, ...clientBrandsOf(c)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, q, fBrand, fKind, fCity, fState]);

  /** Every film made for the open client, newest first. */
  const campaigns = useMemo(
    () => (draft?.id ? projects.filter((p) => p.clientId === draft.id).sort((a, b) => b.updatedAt - a.updatedAt) : []),
    [projects, draft?.id],
  );
  const usual = usualActorFor(projects, draft?.id);
  const actorName = (id?: string) => actors.find((a) => a.id === id)?.name ?? '';
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
    // A client with a brand and no brand logo gets one: looked up, cleaned, and put
    // on the record, without anyone having to go and find the file.
    if (!r.brandLogo && (r.brands?.some((b) => b.trim()) || r.brand?.trim())) {
      setLogoNote('Looking up the brand logo…');
      const pulled = await cleanClientLogos(r.id, false);
      if (isApiError(pulled)) {
        setLogoNote(pulled.message);
        return;
      }
      await refresh();
      const fresh = await get<ClientProfile>(`/api/clients/${r.id}`);
      if (!isApiError(fresh)) setDraft((d) => (d?.id === r.id ? fresh : d));
      setLogoNote(pulled.notes.length ? `${pulled.notes.join('; ')}.` : '');
    }
  };

  /**
   * File the photos by the part of the place they show, then build one sheet per
   * part. The draft is saved first — the server reads the record, not the form —
   * and what comes back replaces the draft, so the new sheets are on screen.
   */
  const buildSheets = async (relabel: boolean) => {
    if (!draft?.id) return;
    setSheetBusy(true);
    setSheetNote('');
    const saved = await api.clients.save(draft);
    if (isApiError(saved)) {
      setSheetBusy(false);
      setSheetNote(saved.message);
      return;
    }
    const r = await buildClientSheets(draft.id, relabel);
    setSheetBusy(false);
    if (isApiError(r)) {
      setSheetNote(r.message);
      return;
    }
    await refresh();
    const fresh = await get<ClientProfile>(`/api/clients/${draft.id}`);
    if (!isApiError(fresh)) setDraft(fresh);
    const filed = Object.entries(r.counts)
      .map(([view, n]) => `${n} ${dealerViewLabel(view as DealerView).toLowerCase()}`)
      .join(', ');
    setSheetNote(
      r.note ??
        [
          r.sheets.length
            ? `Built ${r.sheets.length} sheet${r.sheets.length === 1 ? '' : 's'}`
            : 'No sheet built — a part needs at least two photographs',
          filed ? `from ${filed}` : '',
          r.unfiled ? `· ${r.unfiled} could not be placed — file ${r.unfiled === 1 ? 'it' : 'them'} by hand` : '',
        ]
          .filter(Boolean)
          .join(' ') + '.',
    );
  };

  /**
   * Clean the saved logos and, when asked or when there is none, pull the brand's.
   * Saved first — the server reads the record, not the form — then read back so the
   * transparent logos and their white versions are on screen.
   */
  const tidyLogos = async (pullBrand: boolean) => {
    if (!draft?.id) return;
    setLogoBusy(true);
    setLogoNote('');
    const saved = await api.clients.save(draft);
    if (isApiError(saved)) {
      setLogoBusy(false);
      setLogoNote(saved.message);
      return;
    }
    const r = await cleanClientLogos(draft.id, pullBrand);
    setLogoBusy(false);
    if (isApiError(r)) {
      setLogoNote(r.message);
      return;
    }
    await refresh();
    const fresh = await get<ClientProfile>(`/api/clients/${draft.id}`);
    if (!isApiError(fresh)) setDraft(fresh);
    setLogoNote(r.notes.length ? `${r.notes.join('; ')}.` : 'Nothing to tidy.');
  };

  /*
   * Logos cleaned by an older cleaner are cleaned again when the client is opened.
   * Films clean every logo as they render, but the stored copies — the thumbnails and
   * the placement preview here — stay as they were cleaned, so white left inside a
   * logo by the old cleaner kept showing until someone pressed Clean up logos. Only the
   * logo fields are taken back, so nothing being typed into the client is lost.
   */
  const canEdit = useApp((s) => s.can('creator'));
  useEffect(() => {
    const d = draft;
    if (!d?.id || !canEdit || !(d.logo || d.brandLogo) || (d.logoCleanVersion ?? 1) >= LOGO_CLEAN_VERSION) return;
    let alive = true;
    void (async () => {
      setLogoBusy(true);
      const r = await cleanClientLogos(d.id, false, true);
      setLogoBusy(false);
      if (!alive || isApiError(r)) return;
      await refresh();
      const fresh = await get<ClientProfile>(`/api/clients/${d.id}`);
      if (!alive || isApiError(fresh)) return;
      setDraft((cur) =>
        cur?.id === fresh.id
          ? {
              ...cur,
              logo: fresh.logo,
              logoWhite: fresh.logoWhite,
              brandLogo: fresh.brandLogo,
              brandLogoWhite: fresh.brandLogoWhite,
              logoCleanVersion: fresh.logoCleanVersion,
            }
          : cur,
      );
      setLogoNote('Logos cleaned again, inside as well as around them.');
    })();
    return () => {
      alive = false;
    };
  }, [draft?.id]);

  /** A stored logo's link, made absolute: records written by the server carry the path. */
  const logoView = (img: StoredImage): StoredImage => ({ ...img, url: abs(img.url ?? null) ?? img.url });

  /*
   * Import the client's details from its website and its Google listing together.
   *
   * The website is the client's own word, so it is preferred for everything it has —
   * the logo, the phone, the address — and the Google listing fills in only what the
   * website left out, and brings the showroom photos. With only a Google link, the
   * website that listing names is read too.
   */
  const importDetails = async () => {
    if (!draft) return;
    const site = (draft.website ?? '').trim();
    const q = gmbInput.trim();
    if (!site && !q) return;
    setGmbBusy(true);
    setGmbNote('');
    setSiteLogo(null);
    const isUrl = /^https?:\/\//i.test(q);
    const [g, w] = await Promise.all([
      q ? post<GmbResult>('/api/clients/gmb', isUrl ? { url: q } : { query: q }) : Promise.resolve(null),
      site ? post<SiteResult>('/api/clients/website', { url: site }) : Promise.resolve(null),
    ]);
    const problems: string[] = [];
    const gmb = g && !isApiError(g) ? g : null;
    if (g && isApiError(g)) problems.push(`Google listing: ${g.message}`);
    let web = w && !isApiError(w) ? w : null;
    if (w && isApiError(w)) problems.push(`Website: ${w.message}`);
    if (!site && gmb?.website) {
      const again = await post<SiteResult>('/api/clients/website', { url: gmb.website });
      if (!isApiError(again)) web = again;
    }
    setGmbBusy(false);
    if (!gmb && !web) {
      setGmbNote(problems.join(' ') || 'Nothing could be imported.');
      return;
    }

    const fromSite: string[] = [];
    const fromGoogle: string[] = [];
    const choose = (label: string, siteValue?: string, googleValue?: string, current?: string): string | undefined => {
      if (siteValue?.trim()) {
        fromSite.push(label);
        return siteValue.trim();
      }
      if (googleValue?.trim()) {
        fromGoogle.push(label);
        return googleValue.trim();
      }
      return current;
    };
    const view = (img?: StoredImage): StoredImage | undefined => (img ? { ...img, url: abs(img.url ?? null) ?? img.url } : undefined);
    const importedName = draft.name.trim() || web?.name || gmb?.name || '';
    const patch: Partial<ClientProfile> = {
      name: importedName,
      displayName: draft.displayName?.trim() || suggestDisplayName(importedName),
      phone: choose('phone', web?.phone, gmb?.phone, draft.phone),
      address: choose('address', web?.address, gmb?.address, draft.address),
      city: choose('city', web?.city, gmb?.city, draft.city),
      state: choose('state', web?.state, undefined, draft.state),
      website: web?.url ?? (site || gmb?.website || draft.website),
      ...(web ? { websiteSyncedAt: Date.now() } : {}),
      ...(gmb
        ? {
            gmbPlaceId: gmb.placeId,
            gmbUrl: isUrl ? q : draft.gmbUrl,
            gmbSyncedAt: Date.now(),
            photos: [...draft.photos, ...(gmb.photos.map((p) => view(p)) as StoredImage[])],
          }
        : {}),
    };
    if (web?.logo) {
      const slot = web.logoKind === 'brand' ? 'brand' : 'dealer';
      const logo = view(web.logo)!;
      const white = view(web.logoWhite);
      if (slot === 'brand' ? !draft.brandLogo : !draft.logo) {
        Object.assign(
          patch,
          slot === 'brand' ? { brandLogo: logo, brandLogoWhite: white, brandLogoSource: web.url } : { logo, logoWhite: white },
        );
        fromSite.push(slot === 'brand' ? 'brand logo' : 'logo');
      } else {
        setSiteLogo({ slot, logo, white });
      }
    }
    if (gmb?.photos.length) fromGoogle.push(`${gmb.photos.length} photo${gmb.photos.length === 1 ? '' : 's'}`);
    set(patch);
    setGmbNote(
      [
        fromSite.length ? `From the website: ${fromSite.join(', ')}.` : web ? 'The website had nothing to add.' : '',
        fromGoogle.length ? `From Google: ${fromGoogle.join(', ')}.` : '',
        ...problems,
        'Review, then Save.',
      ]
        .filter(Boolean)
        .join(' '),
    );
  };

  return (
    <div className="browse">
      <datalist id="ava-states">
        {STATES.map((st) => (
          <option key={st} value={st} />
        ))}
      </datalist>
      <div className="card">
        <div className="head">
          <div className="head-left">
            <h2>Clients</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="step">
              {shown.length === clients.length
                ? `${clients.length} saved`
                : `${shown.length} of ${clients.length}`}
            </span>
            <button
              className="btn small primary"
              type="button"
              data-tour="clients-new"
              disabled={!canEdit}
              title={canEdit ? undefined : 'Not available for viewer access'}
              onClick={() => { setDraft(blank()); setGmbNote(''); setGmbInput(''); }}
            >
              New client
            </button>
          </div>
        </div>
        <div className="body tight">
          <div className="browse-bar" data-tour="clients-filters">
            <input
              className="browse-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a dealer, city or brand…"
              aria-label="Search clients"
            />
            <select value={fBrand} onChange={(e) => setFBrand(e.target.value)} aria-label="Filter by brand">
              <option value="">Any brand</option>
              {facets.brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <select value={fKind} onChange={(e) => setFKind(e.target.value)} aria-label="Filter by what they sell">
              <option value="">Cars & bikes</option>
              <option value="car">Cars</option>
              <option value="bike">Bikes & scooters</option>
            </select>
            <select value={fCity} onChange={(e) => setFCity(e.target.value)} aria-label="Filter by city">
              <option value="">Any city</option>
              {facets.cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select value={fState} onChange={(e) => setFState(e.target.value)} aria-label="Filter by state">
              <option value="">Any state</option>
              {facets.states.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {(q || fBrand || fKind || fCity || fState) && (
              <button
                className="btn ghost small"
                type="button"
                onClick={() => { setQ(''); setFBrand(''); setFKind(''); setFCity(''); setFState(''); }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`browse-cols${draft?.id ? ' three' : ' two'}`}>
        <div className="browse-col" data-tour="clients-list">
          <div className="browse-col-head">
            <span>Dealers</span>
            <span>{shown.length}</span>
          </div>
          <div className="browse-list">
            {shown.length === 0 && (
              <div className="hint" style={{ padding: 8 }}>
                {clients.length ? 'Nothing matches those filters.' : 'No clients yet.'}
              </div>
            )}
            {shown.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`browse-item${c.id === draft?.id ? ' on' : ''}`}
                onClick={() => {
                  const next = clients.find((x) => x.id === c.id) ?? null;
                  setDraft(next);
                  setGmbNote('');
                  setGmbInput(next?.gmbUrl ?? '');
                  setSiteLogo(null);
                }}
              >
                <b>{c.name}</b>
                <span>
                  {[clientBrandsOf(c).join(' + '), c.city, c.state].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </div>
        </div>

      <div className="browse-detail">
      {draft ? (
        <Panel
          title={draft.id ? 'Edit client' : 'New client'}
          tour="clients-detail"
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
          <Lock>
          {err && <Banner kind="bad">{err}</Banner>}

          <Field
            label="Import details"
            hint="The website is read first — the logo, phone and address come from there — and the Google listing fills in whatever the website does not have, and brings showroom photos. Only a Google link? The website it names is read too."
          >
            <div className="import-grid">
              <input
                value={draft.website ?? ''}
                onChange={(e) => set({ website: e.target.value })}
                placeholder="Website — www.dealer.com"
                aria-label="Website"
              />
              <input
                value={gmbInput}
                onChange={(e) => setGmbInput(e.target.value)}
                placeholder="Google Maps link, or “Dealer name, city”"
                aria-label="Google Business Profile"
              />
              <button
                className="btn small"
                type="button"
                disabled={gmbBusy || !(draft.website?.trim() || gmbInput.trim())}
                onClick={importDetails}
              >
                {gmbBusy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </Field>
          {gmbNote && <div className="hint" style={{ marginTop: -6, marginBottom: 10 }}>{gmbNote}</div>}
          {siteLogo && (
            <div className="site-logo-offer">
              <div className="logo-dark">
                <Thumb img={siteLogo.logo} />
              </div>
              <span>The website has a {siteLogo.slot === 'brand' ? 'brand' : 'dealership'} logo too.</span>
              <button
                className="btn ghost small"
                type="button"
                onClick={() => {
                  set(
                    siteLogo.slot === 'brand'
                      ? { brandLogo: siteLogo.logo, brandLogoWhite: siteLogo.white }
                      : { logo: siteLogo.logo, logoWhite: siteLogo.white },
                  );
                  setSiteLogo(null);
                }}
              >
                Use the website’s logo
              </button>
            </div>
          )}

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
            <Field label="State">
              <input
                value={draft.state ?? ''}
                onChange={(e) => set({ state: e.target.value })}
                placeholder="e.g. Rajasthan"
                list="ava-states"
              />
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
                  hint="Overlaid on every video where Logo placement below puts it — in colour over the film, in white over the end card. Any file works: the background is taken off when it is uploaded."
                >
                  <div className="thumbs">
                    {draft.logo && (
                      <Thumb img={logoView(draft.logo)} onRemove={() => set({ logo: undefined, logoWhite: undefined })} />
                    )}
                    {draft.logoWhite && (
                      <div className="logo-dark">
                        <Thumb img={logoView(draft.logoWhite)} />
                      </div>
                    )}
                    <ImageUpload
                      label={`${draft.name || 'Client'} — dealership logo`}
                      kind="logo"
                      buttonText={draft.logo ? 'Replace' : 'Upload'}
                      onUploaded={(img) =>
                        set({ logo: img, logoWhite: (img as StoredImage & { white?: StoredImage }).white })
                      }
                    />
                  </div>
                </Field>
                <Field
                  label="Brand logo"
                  hint={
                    draft.brandLogoSource
                      ? `Pulled from ${draft.brandLogoSource}. Upload the dealership's own file if this is not the one they use.`
                      : 'Overlaid where Logo placement below puts it — in colour over the film, in white over the end card. Pulled automatically when there is none, or upload one: the background is taken off.'
                  }
                >
                  <div className="thumbs">
                    {draft.brandLogo && (
                      <Thumb
                        img={logoView(draft.brandLogo)}
                        onRemove={() => set({ brandLogo: undefined, brandLogoWhite: undefined, brandLogoSource: undefined })}
                      />
                    )}
                    {draft.brandLogoWhite && (
                      <div className="logo-dark">
                        <Thumb img={logoView(draft.brandLogoWhite)} />
                      </div>
                    )}
                    <ImageUpload
                      label={`${draft.brand || 'Brand'} — brand logo`}
                      kind="brand-logo"
                      buttonText={draft.brandLogo ? 'Replace' : 'Upload'}
                      onUploaded={(img) =>
                        set({
                          brandLogo: img,
                          brandLogoWhite: (img as StoredImage & { white?: StoredImage }).white,
                          brandLogoSource: undefined,
                        })
                      }
                    />
                  </div>
                </Field>
              </div>
              <Field
                label="Logo placement"
                hint="Which top corner each logo takes on this client's films, or Off to leave it out. Two logos on one side sit next to each other, the brand first. The end card uses the same places."
              >
                <div className="logo-place">
                  <div className="logo-place-rows">
                    {(['dealer', 'brand'] as const).map((k) => {
                      const place = logoLayout(draft.logoPlacement);
                      return (
                        <div className="logo-place-row" key={k}>
                          <span>{k === 'dealer' ? 'Dealership logo' : 'Brand logo'}</span>
                          <div className="seg">
                            {LOGO_SLOTS.map((slot) => (
                              <button
                                key={slot.id}
                                type="button"
                                className={place[k] === slot.id ? 'on' : ''}
                                onClick={() => set({ logoPlacement: { ...place, [k]: slot.id } })}
                              >
                                {slot.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="logo-frame" role="img" aria-label="Where the logos sit on the film">
                    {(['left', 'right'] as const).map((side) => (
                      <div key={side} className={`logo-corner ${side}`}>
                        {logosOn(side, logoLayout(draft.logoPlacement)).map((k) => {
                          const img = k === 'brand' ? draft.brandLogo : draft.logo;
                          return img ? (
                            <img key={k} src={logoView(img).url} alt={k === 'brand' ? 'Brand logo' : 'Dealership logo'} />
                          ) : (
                            <span key={k} className="logo-ph">
                              {k === 'brand' ? 'Brand' : 'Dealer'}
                            </span>
                          );
                        })}
                      </div>
                    ))}
                    <div className="logo-frame-foot" />
                  </div>
                </div>
              </Field>
              <div className="toolbar">
                <button
                  className="btn small"
                  type="button"
                  disabled={logoBusy || !draft.id || !(draft.brands?.length || draft.brand?.trim())}
                  title={draft.id ? "Look up this brand's current logo and use it" : 'Save the client first'}
                  onClick={() => void tidyLogos(true)}
                >
                  {logoBusy ? 'Working…' : draft.brandLogo ? 'Pull brand logo again' : 'Pull brand logo'}
                </button>
                <button
                  className="btn ghost small"
                  type="button"
                  disabled={logoBusy || !draft.id || (!draft.logo && !draft.brandLogo)}
                  title="Take the background off both logos and make their white versions"
                  onClick={() => void tidyLogos(false)}
                >
                  Clean up logos
                </button>
                {logoNote && (
                  <span className="hint" style={{ marginTop: 0 }}>
                    {logoNote}
                  </span>
                )}
              </div>
            </Section>

            {/* A showroom is not one room. A film about a handover wants the delivery
                bay and a sit-down wants the lounge, so each photograph is filed under
                where it was taken — and every photograph of one room goes to the model
                as a single sheet, which spends one of its ten slots instead of six. */}
            <Section
              sub
              title="Showroom photos"
              step={
                draft.photos.length
                  ? `${draft.photos.length} photo${draft.photos.length === 1 ? '' : 's'}${
                      Object.keys(draft.sheets ?? {}).length
                        ? ` · ${Object.keys(draft.sheets ?? {}).length} sheets`
                        : ''
                    }`
                  : 'None yet'
              }
            >
              <div className="thumbs">
                {draft.photos.map((p) => (
                  <div className="veh-photo" key={p.refId}>
                    <Thumb
                      img={p}
                      onRemove={() => set({ photos: draft.photos.filter((x) => x.refId !== p.refId) })}
                    />
                    <select
                      aria-label={`Where ${p.label} was taken`}
                      value={p.view ?? ''}
                      onChange={(e) =>
                        set({
                          photos: draft.photos.map((x) =>
                            x.refId === p.refId
                              ? { ...x, view: (e.target.value || undefined) as DealerView | undefined }
                              : x,
                          ),
                        })
                      }
                    >
                      <option value="">Which part?</option>
                      {DEALER_VIEWS.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <ImageUpload
                  label={`${draft.name || 'Client'} — showroom photo`}
                  onUploaded={(img) => set({ photos: [...draft.photos, img] })}
                  buttonText="Add photo"
                />
              </div>
              <div className="hint">
                Visual references, so a generation matches the real showroom. File each one under the part of the
                place it shows — the ones left blank are looked at when the sheets are built.
              </div>

              <div className="toolbar">
                <button
                  type="button"
                  className="btn small"
                  disabled={sheetBusy || !draft.id || !draft.photos.length}
                  title={
                    draft.id
                      ? 'Look at the unfiled photos, then build one sheet per part of the place'
                      : 'Save the client first'
                  }
                  onClick={() => void buildSheets(false)}
                >
                  {sheetBusy ? 'Working…' : 'Sort photos and build sheets'}
                </button>
                {Object.keys(draft.sheets ?? {}).length > 0 && (
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={sheetBusy || !draft.id}
                    title="Ignore what is filed and look at every photo again"
                    onClick={() => void buildSheets(true)}
                  >
                    Look at all of them again
                  </button>
                )}
                {sheetNote && <span className="hint" style={{ marginTop: 0 }}>{sheetNote}</span>}
              </div>

              {Object.keys(draft.sheets ?? {}).length > 0 && (
                <>
                  <div className="hint" style={{ marginTop: 10 }}>
                    What the model is given for this dealership — one image per part of the place. A part with a
                    sheet does not also send its loose photographs.
                  </div>
                  <div className="thumbs">
                    {DEALER_VIEWS.filter((v) => draft.sheets?.[v.id]).map((v) => (
                      <Thumb key={v.id} img={draft.sheets![v.id]!} />
                    ))}
                  </div>
                </>
              )}
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

          </Lock>
          <div className="toolbar">
            <button className="btn primary" type="button" disabled={!canEdit} onClick={save}>
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

      {/* What this dealership has already had made, beside the dealership rather
          than buried in the middle of its details. */}
      {draft?.id && (
        <div className="browse-side">
          <Panel
            title="Campaigns"
            step={campaigns.length ? `${campaigns.length} film${campaigns.length === 1 ? '' : 's'}` : 'None yet'}
          >
            {usual && (
              <div className="usual-actor">
                <span>
                  <b>{actorName(usual.actorId) || 'One presenter'}</b> fronts {usual.count} of {usual.total} films for
                  this dealer. Keeping the same face is what makes a dealership recognisable — change it only on
                  purpose.
                </span>
              </div>
            )}
            {campaigns.length === 0 ? (
              <div className="hint">No films for this client yet.</div>
            ) : (
              <div className="campaigns">
                {campaigns.map((p) => (
                  <button key={p.id} type="button" className="campaign" onClick={() => go('projects', p.id)}>
                    <b>{p.name || 'Untitled project'}</b>
                    <span className="campaign-tags">
                      {p.useCases.map((u) => (
                        <span className="chip accent" key={u}>
                          {CATEGORIES.find((c) => c.id === u)?.label ?? u}
                        </span>
                      ))}
                      {actorName(p.actorId) && <span className="chip">{actorName(p.actorId)}</span>}
                    </span>
                    <span className="campaign-meta">
                      {PROJECT_STAGES.find((st) => st.id === projectStage(p))?.label}
                      {' · '}
                      {new Date(p.updatedAt).toLocaleDateString()}
                      {p.generationCount ? ` · ${p.generationCount} run${p.generationCount === 1 ? '' : 's'}` : ''}
                      {canEdit && p.totalCostInr ? ` · ${formatInr(p.totalCostInr)}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}
      </div>
    </div>
  );
}
