import { useMemo, useState } from 'react';
import {
  CREATIVE_ENGINE_BY_ID,
  CREATIVE_FORMAT_BY_ID,
  emptyImageProject,
  formatInr,
  type CreativeFormatId,
  type ImageProject,
} from '@ava/shared';
import { api, useApp } from '../state/appStore.js';
import { isApiError } from '../lib/client.js';
import { refUrl } from '../lib/api.js';
import { useReadOnly } from '../components/ui.js';
import { ProjectsSection } from './Projects.js';
import { ProjectKindContext, ProjectKindSwitch, keepProjectKind, readProjectKind, type ProjectKind } from './projectKind.js';

/** Projects, as films or as social creatives. The choice is kept on this device. */
export function ProjectsHome() {
  const [kind, setKind] = useState<ProjectKind>(readProjectKind);
  const pick = (k: ProjectKind): void => {
    setKind(k);
    keepProjectKind(k);
  };
  return (
    <ProjectKindContext.Provider value={{ kind, pick }}>
      {kind === 'image' ? <ImageProjectsSection /> : <ProjectsSection />}
    </ProjectKindContext.Provider>
  );
}

/** Sizes by a word, for a card. */
const SHORT: Record<CreativeFormatId, string> = {
  'ig-square': 'Square',
  'ig-portrait': 'Portrait',
  story: 'Story',
  landscape: 'Landscape',
  thumbnail: 'Thumbnail',
  'cd-970x90': '970×90',
  'cd-720x90': '720×90',
  'cd-300x250': '300×250',
  'cd-300x600': '300×600',
  'cd-310x100': '310×100',
};

/** The image projects: one post each, in every size it goes out in. */
export function ImageProjectsSection() {
  const { imageProjects, clients, cars, refresh, goImage } = useApp();
  const readOnly = useReadOnly();
  const isAdmin = useApp((s) => s.can('admin'));
  const [q, setQ] = useState('');
  const [clientId, setClientId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const clientName = (id?: string) => {
    const c = clients.find((x) => x.id === id);
    return c ? c.displayName || c.name : '';
  };
  const carName = (id?: string) => {
    const c = cars.find((x) => x.id === id);
    return c ? `${c.brand} ${c.model}` : '';
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return imageProjects
      .filter((p) => !clientId || p.clientId === clientId)
      .filter((p) => !needle || [p.name, p.prompt, clientName(p.clientId), carName(p.carId)].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageProjects, q, clientId, clients, cars]);
  const spend = imageProjects.reduce((s, p) => s + (p.totalCostInr ?? 0), 0);

  const create = async (): Promise<void> => {
    setCreating(true);
    setError('');
    const r = await api.imageProjects.save({ ...emptyImageProject(), ...(clientId ? { clientId } : {}) } as Partial<ImageProject>);
    setCreating(false);
    if (isApiError(r)) return setError(r.message);
    await refresh();
    goImage(r.id);
  };

  const thumbOf = (p: ImageProject): string | null => {
    const saved = p.creatives.find((c) => c.approved && c.png) ?? p.creatives.find((c) => c.png);
    if (saved?.png) return refUrl(saved.png.storagePath);
    const design = Object.values(p.designs ?? {}).find(Boolean);
    if (design) return refUrl(design.image.storagePath);
    const pic = Object.values(p.pictures ?? {}).find(Boolean);
    if (pic) return refUrl(pic.image.storagePath);
    return p.heroPhoto ? refUrl(p.heroPhoto.storagePath) : null;
  };

  return (
    <div className="browse">
      <div className="card">
        <div className="head">
          <div className="head-left">
            <h2>Projects</h2>
            <ProjectKindSwitch />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="step">
              {filtered.length} of {imageProjects.length}
              {spend && isAdmin ? ` · ${formatInr(spend)} spent` : ''}
            </span>
            <button
              className="btn small primary"
              type="button"
              disabled={creating || readOnly}
              title={readOnly ? 'Not available for viewer access' : undefined}
              onClick={() => void create()}
            >
              {creating ? 'Creating…' : 'New creative'}
            </button>
          </div>
        </div>
        <div className="body tight">
          <div className="section-desc">
            One project = one post, in every size it goes out in. Pick the client and the vehicle, say what the post is about, and the creatives are laid out for you —
            with the real car, the client's logos and panel, and words you can change.
          </div>
          <div className="list-head">
            <input className="grow" placeholder="Search creatives" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search creatives" />
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName || c.name}
                </option>
              ))}
            </select>
          </div>
          {error && <div className="banner bad">{error}</div>}
        </div>
      </div>

      <div className="browse-scroll">
        {filtered.length === 0 ? (
          <div className="card">
            <div className="body">
              <div className="empty">
                {imageProjects.length ? 'Nothing matches that search.' : 'No image projects yet. Start one with New creative — a festival wish, an offer, a delivery.'}
              </div>
            </div>
          </div>
        ) : (
          <div className="ip-grid">
            {filtered.map((p) => {
              const thumb = thumbOf(p);
              const engine = p.engine ? CREATIVE_ENGINE_BY_ID[p.engine.primary] : undefined;
              return (
                <button key={p.id} type="button" className="ip-card" onClick={() => goImage(p.id)}>
                  <span className="ip-thumb">{thumb ? <img src={thumb} alt="" loading="lazy" crossOrigin="anonymous" /> : <span className="ip-thumb-empty">🖼️</span>}</span>
                  <span className="ip-card-body">
                    <b>{p.name?.trim() || 'Untitled creative'}</b>
                    <span className="ip-tags">
                      {clientName(p.clientId) && <span className="chip">{clientName(p.clientId)}</span>}
                      {carName(p.carId) && <span className="chip">{carName(p.carId)}</span>}
                      {engine && <span className="chip">{engine.label}</span>}
                    </span>
                    <span className="ip-meta">
                      {p.formats.filter((f) => CREATIVE_FORMAT_BY_ID[f]).map((f) => SHORT[f]).join(', ')}
                      {' · '}
                      {new Date(p.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      {isAdmin && p.totalCostInr ? ` · ${formatInr(p.totalCostInr)}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
