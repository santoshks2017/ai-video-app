import { useEffect, useMemo, useState } from 'react';
import type { CarModelProfile, CarAngle, StoredImage, BrandEntry, VehicleDataSource } from '@ava/shared';
import { BRAND_CATALOGUE } from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, Section, ImageUpload, Thumb, Confirm, Empty, Banner } from '../components/ui.js';
import { isApiError, post, get, abs, recheckCarPhotos } from '../lib/client.js';

const ANGLES: CarAngle[] = ['front', 'side', 'rear', 'interior'];

function withAbsUrls(car: CarModelProfile): CarModelProfile {
  const fix = (i: StoredImage): StoredImage => ({ ...i, url: abs(i.url ?? null) ?? i.url });
  return {
    ...car,
    images: Object.fromEntries(
      Object.entries(car.images ?? {}).map(([k, v]) => [k, (v ?? []).map(fix)]),
    ) as CarModelProfile['images'],
    colours: (car.colours ?? []).map((c) => ({ ...c, image: c.image ? fix(c.image) : undefined })),
  };
}

export function CarsSection() {
  const cars = useApp((s) => s.cars);
  const refresh = useApp((s) => s.refresh);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<'car' | 'bike'>('car');
  const [brand, setBrand] = useState<BrandEntry | null>(null);
  const [preview, setPreview] = useState<{ slug: string; name: string }[] | null>(null);
  const [syncLog, setSyncLog] = useState<{ name: string; status: string; note?: string }[]>([]);
  const [brandBusy, setBrandBusy] = useState('');
  const [brandErr, setBrandErr] = useState('');
  const [brandQuery, setBrandQuery] = useState('');
  /** The brand whose models the middle column is showing. */
  const [pickedBrand, setPickedBrand] = useState<string | null>(null);
  const [oemUrl, setOemUrl] = useState('');
  const [sourceBusy, setSourceBusy] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [checkBusy, setCheckBusy] = useState(false);

  /**
   * Look at this vehicle's photos and file each under what it shows. CarDekho
   * names its files by angle and the names are a guess — a file named for the
   * front can hold a side profile, which is how a film came back with the wrong
   * face on the right car.
   */
  const recheck = async () => {
    if (!activeId) return;
    setCheckBusy(true);
    setSourceNote('');
    const r = await recheckCarPhotos(activeId);
    setCheckBusy(false);
    if (isApiError(r)) {
      setSourceNote(`${r.code}: ${r.message}`);
      return;
    }
    await refresh();
    setSourceNote(
      r.moved.length || r.dropped.length
        ? `Re-filed: ${[...r.moved, ...r.dropped.map((d) => `dropped ${d}`)].join('; ')}.`
        : 'Every photo was already filed correctly.',
    );
  };

  const brands = BRAND_CATALOGUE.filter((b) => b.kind === kind);

  /** Cheap: one fetch, no downloads — lets you see the line-up before committing. */
  const listModels = async (b: BrandEntry) => {
    setBrand(b);
    setPreview(null);
    setSyncLog([]);
    setBrandErr('');
    setBrandBusy(`Reading ${b.name}…`);
    const r = await get<{ brand: BrandEntry; items: { slug: string; name: string }[] }>(
      `/api/brands/models?brand=${encodeURIComponent(b.slug)}&kind=${b.kind}`,
    );
    setBrandBusy('');
    if (isApiError(r)) {
      setPreview(null);
      setBrandErr(`${r.code}: ${r.message}`);
      return;
    }
    setBrandErr('');
    setPreview(r.items);
  };

  const syncBrand = async (b: BrandEntry, limit?: number) => {
    setBrandBusy(`Syncing ${b.name}${limit ? ` (first ${limit})` : ''} — this takes a few minutes…`);
    setSyncLog([]);
    const r = await post<{ found: number; results: { name: string; status: string; note?: string }[] }>(
      '/api/brands/sync',
      { brand: b.slug, kind: b.kind, limit },
    );
    setBrandBusy('');
    if (isApiError(r)) {
      setBrandErr(`${r.code}: ${r.message}`);
      return;
    }
    setBrandErr('');
    setSyncLog(r.results);
    setNote(`${b.name}: ${r.results.length} of ${r.found} models synced.`);
    await refresh();
  };

  const active = useMemo(() => {
    const c = cars.find((x) => x.id === activeId);
    return c ? withAbsUrls(c) : null;
  }, [cars, activeId]);

  // The link belongs to the vehicle, not to the screen.
  useEffect(() => {
    setOemUrl(cars.find((x) => x.id === activeId)?.oemUrl ?? '');
    setSourceNote('');
  }, [activeId, cars]);

  const brandRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = cars
      .filter((c) => (c.kind ?? 'car') === kind)
      .filter((c) => !q || `${c.brand} ${c.model}`.toLowerCase().includes(q));
    const map = new Map<string, CarModelProfile[]>();
    for (const c of list) map.set(c.brand, [...(map.get(c.brand) ?? []), c]);
    return [...map.entries()]
      .map(([name, models]) => ({
        name,
        models: models.sort((a, b) => a.model.localeCompare(b.model)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cars, filter, kind]);

  // A brand that the search has filtered away stops being the one on screen.
  const currentBrand = brandRows.some((b) => b.name === pickedBrand)
    ? pickedBrand
    : (brandRows[0]?.name ?? null);
  const shownModels = brandRows.find((b) => b.name === currentBrand)?.models ?? [];

  const sync = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setNote('');
    // A pasted link is a manufacturer page; a name is a CarDekho lookup.
    const link = /^https?:\/\//i.test(q);
    const r = await post<CarModelProfile>('/api/cars/sync', link ? { url: q, source: 'oem', kind } : { query: q, kind });
    setBusy(false);
    if (isApiError(r)) {
      setNote(r.message);
      return;
    }
    await refresh();
    setActiveId(r.id);
    setQuery('');
    const angles = Object.keys(r.images ?? {}).length;
    setNote(
      `Synced ${r.brand} ${r.model}: ${angles} angle set${angles === 1 ? '' : 's'}, ` +
        `${r.colours.length} colour${r.colours.length === 1 ? '' : 's'}, ${r.variants.length} variant${
          r.variants.length === 1 ? '' : 's'
        }.` + (r.syncNote ? ` ${r.syncNote}` : ''),
    );
  };

  /**
   * Re-read this vehicle from the site the team picked. The record keeps its id, so
   * every project already pointing at this vehicle follows the switch.
   */
  const resync = async (source: VehicleDataSource) => {
    if (!active) return;
    const url = oemUrl.trim();
    if (source === 'oem' && !url) {
      setSourceNote('Paste the manufacturer page for this model first.');
      return;
    }
    setSourceNote('');
    setSourceBusy(source === 'oem' ? 'Reading the manufacturer page…' : 'Syncing from CarDekho…');
    const r = await post<CarModelProfile>('/api/cars/sync', {
      id: active.id,
      source,
      url: url || undefined,
      kind: active.kind ?? 'car',
    });
    setSourceBusy('');
    if (isApiError(r)) {
      setSourceNote(`${r.code}: ${r.message}`);
      return;
    }
    await refresh();
    setActiveId(r.id);
    const angles = Object.keys(r.images ?? {}).length;
    setSourceNote(
      `Synced from ${r.source === 'oem' ? 'the manufacturer site' : 'CarDekho'}: ${angles} angle set${
        angles === 1 ? '' : 's'
      }, ${r.colours.length} colour${r.colours.length === 1 ? '' : 's'}, ${r.variants.length} variant${
        r.variants.length === 1 ? '' : 's'
      }.${r.syncNote ? ` ${r.syncNote}` : ''}`,
    );
  };

  const patchActive = async (fields: Partial<CarModelProfile>) => {
    if (!activeId) return;
    await api.cars.patch(activeId, fields);
    await refresh();
  };

  return (
    <div className="browse">
      {/* The tools that put vehicles in the library, above the library itself. */}
      <div className="card">
        <div className="head">
          <div className="head-left">
            <h2>Vehicles</h2>
          </div>
          <span className="step">
            {cars.length} model{cars.length === 1 ? '' : 's'} · {brandRows.length} brand
            {brandRows.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="body tight">
          <div className="browse-bar">
            <input
              className="browse-search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search every brand and model…"
              aria-label="Search vehicles"
            />
          </div>

          <div className="sec-stack" style={{ marginTop: 10 }}>
            <Section sub title="Add a brand" step="Sync its whole current line-up">
              <div className="brandgrid">
                {brands.map((b) => (
                  <button
                    key={b.slug}
                    type="button"
                    className={`brandchip${brand?.slug.toLowerCase() === b.slug.toLowerCase() ? ' on' : ''}`}
                    disabled={Boolean(brandBusy)}
                    onClick={() => listModels(b)}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  value={brandQuery}
                  onChange={(e) => setBrandQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && brandQuery.trim())
                      listModels({ name: brandQuery.trim(), slug: brandQuery.trim(), kind });
                  }}
                  placeholder={
                    kind === 'bike'
                      ? 'Any other brand — e.g. Suzuki, Yamaha, KTM'
                      : 'Any other brand — e.g. Kia, Toyota, Skoda'
                  }
                />
                <button
                  className="btn small"
                  type="button"
                  disabled={!brandQuery.trim() || Boolean(brandBusy)}
                  onClick={() => listModels({ name: brandQuery.trim(), slug: brandQuery.trim(), kind })}
                >
                  Find models
                </button>
              </div>

              {brandBusy && <div className="hint">{brandBusy}</div>}
              {brandErr && (
                <div className="check bad" style={{ marginTop: 8 }}>
                  <span className="icon">✕</span>
                  <span>{brandErr}</span>
                </div>
              )}

              {brand && preview && !brandBusy && (
                <div className="brandpreview">
                  <div className="hint">
                    <b>{brand.name}</b> — {preview.length} current model{preview.length === 1 ? '' : 's'} on{' '}
                    {brand.kind === 'car' ? 'CarDekho' : 'BikeDekho'}. Discontinued and unlaunched models are left
                    out.
                  </div>
                  <div className="modellist">{preview.map((m) => m.name).join(' · ')}</div>
                  <div className="toolbar">
                    <button className="btn small" type="button" onClick={() => syncBrand(brand, 3)}>
                      Try 3 models first
                    </button>
                    <button className="btn primary small" type="button" onClick={() => syncBrand(brand)}>
                      Sync all {preview.length}
                    </button>
                  </div>
                </div>
              )}

              {syncLog.length > 0 && (
                <div className="synclog">
                  {syncLog.map((r, i) => (
                    <div
                      className={`syncrow ${
                        /^(ok|already)/.test(r.status) ? 'ok' : r.status === 'failed' ? 'bad' : 'warn'
                      }`}
                      key={i}
                    >
                      <b>{r.name}</b>
                      <span>
                        {r.status}
                        {r.note ? ` · ${r.note}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section sub title="Add one model" step="By name, or a manufacturer link">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sync()}
                  placeholder="Hyundai Creta — or a manufacturer page link"
                />
                <button className="btn small primary" type="button" disabled={busy || !query.trim()} onClick={sync}>
                  {busy ? 'Syncing…' : 'Sync'}
                </button>
              </div>
              <div className="hint">
                e.g. &ldquo;Hyundai Creta&rdquo;, &ldquo;royal-enfield/classic-350&rdquo; for a bike, or a link like
                https://auto.mahindra.com/suv/xuv3xo/X3XO.html
              </div>
              {note && <div className="hint">{note}</div>}
            </Section>
          </div>
        </div>
      </div>

      {/* What is being browsed, right above the thing being browsed. */}
      <div className="browse-switch">
        <div className="seg">
          {(['car', 'bike'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={kind === k ? 'on' : ''}
              onClick={() => {
                setKind(k);
                setBrand(null);
                setPreview(null);
                setSyncLog([]);
                setPickedBrand(null);
              }}
            >
              {k === 'car' ? 'Cars' : 'Bikes & scooters'}
            </button>
          ))}
        </div>
        <span className="hint">
          {brandRows.reduce((n, b) => n + b.models.length, 0)} {kind === 'bike' ? 'bikes & scooters' : 'cars'} in the
          library
        </span>
      </div>

      {/* Brand, then model, then the vehicle — each column narrowing the last. */}
      <div className="browse-cols">
        <div className="browse-col">
          <div className="browse-col-head">
            <span>Brands</span>
            <span>{brandRows.length}</span>
          </div>
          <div className="browse-list">
            {brandRows.length === 0 && (
              <div className="hint" style={{ padding: 8 }}>
                {filter.trim() ? 'Nothing matches that.' : `No ${kind === 'bike' ? 'bikes' : 'cars'} synced yet.`}
              </div>
            )}
            {brandRows.map((b) => (
              <button
                key={b.name}
                type="button"
                className={`browse-item${b.name === currentBrand ? ' on' : ''}`}
                onClick={() => setPickedBrand(b.name)}
              >
                <b>{b.name}</b>
                <span>
                  {b.models.length} model{b.models.length === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="browse-col">
          <div className="browse-col-head">
            <span>{currentBrand ?? 'Models'}</span>
            <span>{shownModels.length}</span>
          </div>
          <div className="browse-list">
            {shownModels.length === 0 && (
              <div className="hint" style={{ padding: 8 }}>
                Pick a brand on the left.
              </div>
            )}
            {shownModels.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`browse-item${c.id === activeId ? ' on' : ''}`}
                onClick={() => setActiveId(c.id)}
              >
                <b>{c.model}</b>
                <span>
                  {c.variants.length} variant{c.variants.length === 1 ? '' : 's'} · {c.colours.length} colour
                  {c.colours.length === 1 ? '' : 's'} · <span className={`sync-${c.syncStatus}`}>{c.syncStatus}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="browse-detail">
          {active ? (
            <Panel
              title={`${active.brand} ${active.model}`}
              step={active.syncedAt ? `synced ${new Date(active.syncedAt).toLocaleDateString()}` : undefined}
              actions={
                <>
                  <button
                    className="btn ghost small"
                    type="button"
                    disabled={checkBusy || Boolean(sourceBusy)}
                    title="Look at each photo and file it under what it actually shows"
                    onClick={() => void recheck()}
                  >
                    {checkBusy ? 'Looking…' : 'Check the photos'}
                  </button>
                  <button
                    className="btn ghost small"
                    type="button"
                    disabled={Boolean(sourceBusy)}
                    onClick={() => resync(active.source ?? 'cardekho')}
                  >
                    {sourceBusy ? 'Syncing…' : 'Re-sync'}
                  </button>
                  <Confirm
                    onConfirm={async () => {
                      await api.cars.remove(active.id);
                      setActiveId(null);
                      await refresh();
                    }}
                  >
                    Delete
                  </Confirm>
                </>
              }
            >
              {active.syncStatus !== 'ok' && (
                <Banner kind="warn">
                  {active.syncNote ?? 'Incomplete image set — add the missing angles below.'}
                </Banner>
              )}

              <h3 style={{ margin: '0 0 8px' }}>Angles</h3>
              <div className="field-grid">
                {ANGLES.map((angle) => {
                  const imgs = active.images?.[angle] ?? [];
                  return (
                    <Field key={angle} label={angle[0]!.toUpperCase() + angle.slice(1)}>
                      <div className="thumbs">
                        {imgs.map((img) => (
                          <div className="veh-photo" key={img.refId}>
                            <Thumb
                              img={img}
                              onRemove={() =>
                                patchActive({
                                  images: { ...active.images, [angle]: imgs.filter((x) => x.refId !== img.refId) },
                                })
                              }
                            />
                            {/* Filed wrongly, it can be moved by hand — the check is
                                a machine looking at a picture, not an oracle. */}
                            <select
                              aria-label={`What ${img.label} shows`}
                              value={angle}
                              onChange={(e) => {
                                const to = e.target.value as CarAngle;
                                if (to === angle) return;
                                patchActive({
                                  images: {
                                    ...active.images,
                                    [angle]: imgs.filter((x) => x.refId !== img.refId),
                                    [to]: [...(active.images?.[to] ?? []), { ...img, angle: to }],
                                  },
                                });
                              }}
                            >
                              {ANGLES.map((a) => (
                                <option key={a} value={a}>
                                  {a[0]!.toUpperCase() + a.slice(1)}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                        <ImageUpload
                          label={`${active.brand} ${active.model} — ${angle}`}
                          kind="car-model"
                          buttonText="Add"
                          onUploaded={(img) => patchActive({ images: { ...active.images, [angle]: [...imgs, img] } })}
                        />
                      </div>
                    </Field>
                  );
                })}
              </div>

              <div className="sec-stack">
                {/* Which site this vehicle's photos and numbers come from. A client who asks
                    "where did this car come from?" is answered by the manufacturer's own page. */}
                <Section
                  sub
                  title="Where its photos come from"
                  step={active.source === 'oem' ? 'The manufacturer site' : 'CarDekho'}
                >
                  <div className="source-head">
                    <b>Source: {active.source === 'oem' ? 'manufacturer website' : 'CarDekho'}</b>
                    <span className="hint">
                      {active.syncedAt ? `synced ${new Date(active.syncedAt).toLocaleDateString()}` : 'never synced'}
                      {active.sourceUrl ? ' · ' : ''}
                      {active.sourceUrl && (
                        <a href={active.sourceUrl} target="_blank" rel="noreferrer">
                          the page it came from
                        </a>
                      )}
                    </span>
                  </div>
                  <Field label="Manufacturer page for this model">
                    <input
                      value={oemUrl}
                      onChange={(e) => setOemUrl(e.target.value)}
                      onBlur={() => {
                        const next = oemUrl.trim();
                        if (next !== (active.oemUrl ?? '')) void patchActive({ oemUrl: next || undefined });
                      }}
                      placeholder="https://auto.mahindra.com/suv/xuv3xo/X3XO.html"
                    />
                  </Field>
                  <div className="toolbar" style={{ marginTop: 0 }}>
                    <button
                      className={`btn small${active.source === 'oem' ? '' : ' primary'}`}
                      type="button"
                      disabled={Boolean(sourceBusy)}
                      onClick={() => resync('cardekho')}
                    >
                      Sync from CarDekho
                    </button>
                    <button
                      className={`btn small${active.source === 'oem' ? ' primary' : ''}`}
                      type="button"
                      disabled={Boolean(sourceBusy) || !oemUrl.trim()}
                      onClick={() => resync('oem')}
                    >
                      Sync from manufacturer site
                    </button>
                  </div>
                  <div className="hint">
                    Re-syncing replaces this vehicle's photos, colours, variants and specifications with that
                    site's. Projects using it keep working and pick up the new photos.
                  </div>
                  {sourceBusy && <div className="hint">{sourceBusy}</div>}
                  {sourceNote && <div className="hint">{sourceNote}</div>}
                </Section>

                <Section sub title="Colours" step={`${active.colours.length} on the source page`}>
                  <div className="swatches">
                    {active.colours.map((c) => (
                      <div className="swatch" key={c.name} title={c.hex}>
                        {c.image?.url ? (
                          <img src={c.image.url} alt={c.name} />
                        ) : (
                          <div className="swatch-chip" style={{ background: c.hex ?? '#ccc' }} />
                        )}
                        <span>{c.name}</span>
                      </div>
                    ))}
                    {active.colours.length === 0 && <div className="hint">No colours found.</div>}
                  </div>
                </Section>

                <Section sub title="Variants" step={`${active.variants.length} on the source page`}>
                  <div className="variant-table">
                    {active.variants.map((v) => (
                      <div className="variant-row" key={v.name}>
                        <b>{v.name}</b>
                        <span>{[v.fuel, v.transmission].filter(Boolean).join(' · ')}</span>
                        <span>{v.price ? `₹${v.price}` : ''}</span>
                      </div>
                    ))}
                    {active.variants.length === 0 && (
                      <div className="hint">No variants found on the source page.</div>
                    )}
                  </div>
                </Section>
              </div>
            </Panel>
          ) : (
            <Panel title="Vehicle details">
              <Empty icon="🚗">Pick a brand, then a model — or sync a new one above.</Empty>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
