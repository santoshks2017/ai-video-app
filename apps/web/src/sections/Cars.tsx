import { useMemo, useState } from 'react';
import type { CarModelProfile, CarAngle, StoredImage, BrandEntry } from '@ava/shared';
import { BRAND_CATALOGUE } from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, PickList, ImageUpload, Thumb, Confirm, Empty, Banner } from '../components/ui.js';
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
    const r = await post<CarModelProfile>('/api/cars/sync', { query: q, kind });
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
          Cars come from CarDekho, bikes and scooters from BikeDekho — real current images, every colour, the
          full variant list and the specifications a script can quote. Pick a brand to pull its whole line-up.
        </div>

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

        <div className="divider" />
        <Field label="Or sync one model" hint='e.g. "Hyundai Creta", or "royal-enfield/classic-350" for a bike.'>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sync()}
              placeholder="Hyundai Creta"
            />
            <button className="btn small primary" type="button" disabled={busy || !query.trim()} onClick={sync}>
              {busy ? 'Syncing…' : 'Sync'}
            </button>
          </div>
        </Field>
        {note && <div className="hint" style={{ marginTop: -4, marginBottom: 10 }}>{note}</div>}

        <div className="divider" />
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
                onClick={() => {
                  setQuery(`${active.brand} ${active.model}`);
                  setNote('Press Sync to refresh this model.');
                }}
              >
                Re-sync
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

          <h3 style={{ marginBottom: 8 }}>Angles</h3>
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

          <div className="divider" />
          <h3 style={{ marginBottom: 8 }}>Colours ({active.colours.length})</h3>
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

          <div className="divider" />
          <h3 style={{ marginBottom: 8 }}>Variants ({active.variants.length})</h3>
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
        </Panel>
      ) : (
        <Panel title="Car details">
          <Empty icon="🚗">Sync a model, or pick one on the left.</Empty>
        </Panel>
      )}
    </div>
  );
}
