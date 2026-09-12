import { useEffect, useMemo, useState } from 'react';
import type { CarModelProfile, CarAngle, StoredImage, BrandEntry, VehicleDataSource } from '@ava/shared';
import { BRAND_CATALOGUE } from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, Section, PickList, ImageUpload, Thumb, Confirm, Empty, Banner } from '../components/ui.js';
import { isApiError, post, get, abs } from '../lib/client.js';

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
  const [oemUrl, setOemUrl] = useState('');
  const [sourceBusy, setSourceBusy] = useState('');
  const [sourceNote, setSourceNote] = useState('');

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

  const byBrand = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? cars.filter((c) => `${c.brand} ${c.model}`.toLowerCase().includes(q))
      : cars;
    const map = new Map<string, CarModelProfile[]>();
    for (const c of list) {
      const arr = map.get(c.brand) ?? [];
      arr.push(c);
      map.set(c.brand, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cars, filter]);

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
    <div className="grid two">
      <Panel
        title="Vehicles"
        step={`${cars.length} model${cars.length === 1 ? '' : 's'}`}
      >
        <div className="section-desc">
          Cars come from CarDekho, bikes and scooters from BikeDekho — current images, every colour, the full
          variant list and the specifications a script can quote. A manufacturer's own model page works too.
        </div>

        <div className="sec-stack" style={{ marginTop: 0, marginBottom: 12 }}>
          <Section sub title="Sync a brand" step="Its whole current line-up">
            <div className="toolbar" style={{ marginTop: 0 }}>
              {(['car', 'bike'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`btn small${kind === k ? ' primary' : ''}`}
                  onClick={() => { setKind(k); setBrand(null); setPreview(null); setSyncLog([]); }}
                >
                  {k === 'car' ? 'Cars' : 'Bikes & scooters'}
                </button>
              ))}
            </div>

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
                  if (e.key === 'Enter' && brandQuery.trim()) listModels({ name: brandQuery.trim(), slug: brandQuery.trim(), kind });
                }}
                placeholder={kind === 'bike' ? 'Any other brand — e.g. Suzuki, Yamaha, KTM' : 'Any other brand — e.g. Kia, Toyota, Skoda'}
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

            {brandBusy && <div className="hint" style={{ marginTop: 8 }}>{brandBusy}</div>}
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
                  {brand.kind === 'car' ? 'CarDekho' : 'BikeDekho'}. Discontinued and unlaunched models are left out.
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
                  <div className={`syncrow ${/^(ok|already)/.test(r.status) ? 'ok' : r.status === 'failed' ? 'bad' : 'warn'}`} key={i}>
                    <b>{r.name}</b>
                    <span>{r.status}{r.note ? ` · ${r.note}` : ''}</span>
                  </div>
                ))}
              </div>
            )}

          </Section>

          <Section sub title="Sync one model" step="Or a manufacturer link">
            <Field
              label="The model"
              hint='e.g. "Hyundai Creta", "royal-enfield/classic-350" for a bike, or a link like https://auto.mahindra.com/suv/xuv3xo/X3XO.html'
            >
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
            </Field>
            {note && <div className="hint">{note}</div>}
          </Section>
        </div>

        <Field label="Filter">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search brand or model…" />
        </Field>

        {byBrand.length === 0 && <div className="hint">No cars synced yet.</div>}
        {byBrand.map(([brand, models]) => (
          <div key={brand} style={{ marginBottom: 10 }}>
            <div className="brand-head">{brand}</div>
            <PickList
              items={models}
              activeId={activeId}
              onPick={setActiveId}
              emptyText=""
              render={(c) => (
                <>
                  <b>{c.model}</b>
                  <span>
                    {c.variants.length} variant{c.variants.length === 1 ? '' : 's'} · {c.colours.length} colour
                    {c.colours.length === 1 ? '' : 's'} ·{' '}
                    <span className={`sync-${c.syncStatus}`}>{c.syncStatus}</span>
                  </span>
                </>
              )}
            />
          </div>
        ))}
      </Panel>

      {active ? (
        <Panel
          title={`${active.brand} ${active.model}`}
          step={active.syncedAt ? `synced ${new Date(active.syncedAt).toLocaleDateString()}` : undefined}
          actions={
            <>
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
            <Banner kind="warn">{active.syncNote ?? 'Incomplete image set — add the missing angles below.'}</Banner>
          )}

          {/* Which site this vehicle's photos and numbers come from. A client who asks
              "where did this car come from?" is answered by the manufacturer's own page. */}
          <div className="sec-stack" style={{ marginTop: 0 }}>
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
              Re-syncing replaces this vehicle's photos, colours, variants and specifications with that site's.
              Projects using it keep working and pick up the new photos.
            </div>
            {sourceBusy && <div className="hint">{sourceBusy}</div>}
            {sourceNote && <div className="hint">{sourceNote}</div>}
          </Section>
          </div>

          <h3 style={{ margin: '14px 0 8px' }}>Angles</h3>
          <div className="field-grid">
          {ANGLES.map((angle) => {
            const imgs = active.images?.[angle] ?? [];
            return (
              <Field key={angle} label={angle[0]!.toUpperCase() + angle.slice(1)}>
                <div className="thumbs">
                  {imgs.map((img) => (
                    <Thumb
                      key={img.refId}
                      img={img}
                      onRemove={() =>
                        patchActive({
                          images: { ...active.images, [angle]: imgs.filter((x) => x.refId !== img.refId) },
                        })
                      }
                    />
                  ))}
                  <ImageUpload
                    label={`${active.brand} ${active.model} — ${angle}`}
                    kind="car-model"
                    buttonText="Add"
                    onUploaded={(img) =>
                      patchActive({ images: { ...active.images, [angle]: [...imgs, img] } })
                    }
                  />
                </div>
              </Field>
            );
          })}
          </div>

          <div className="sec-stack">
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
            {active.variants.length === 0 && <div className="hint">No variants found on the source page.</div>}
          </div>
          </Section>
          </div>
        </Panel>
      ) : (
        <Panel title="Car details">
          <Empty icon="🚗">Sync a model, or pick one on the left.</Empty>
        </Panel>
      )}
    </div>
  );
}
