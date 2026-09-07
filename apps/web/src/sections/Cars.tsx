import { useMemo, useState } from 'react';
import type { CarModelProfile, CarAngle, StoredImage } from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, PickList, ImageUpload, Thumb, Confirm, Empty, Banner } from '../components/ui.js';
import { isApiError, post, abs } from '../lib/client.js';

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
    const r = await post<CarModelProfile>('/api/cars/sync', { query: q });
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
        title="Cars"
        step={`${cars.length} model${cars.length === 1 ? '' : 's'}`}
      >
        <div className="section-desc">
          Sync a model from CarDekho to pull its real, current images — angle shots, every colour, and the full
          variant list. These reference images are what stop the model inventing an outdated or wrong car.
        </div>
        <Field label="Sync a model" hint='Brand + model, e.g. "Hyundai Creta" or "Maruti Suzuki Baleno".'>
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
