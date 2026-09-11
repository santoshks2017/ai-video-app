import { useMemo, useState } from 'react';
import { CATEGORIES, emptyProject, formatInr, type CategoryId, type Project } from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Panel, Empty } from '../components/ui.js';
import { isApiError } from '../lib/client.js';

const STATUS_LABEL: Record<Project['status'], string> = {
  draft: 'Draft',
  ready: 'Ready',
  generating: 'Generating',
  generated: 'Generated',
  failed: 'Failed',
};

export function ProjectsSection() {
  const { projects, clients, actors, cars, refresh, go } = useApp();
  const [q, setQ] = useState('');
  const [clientId, setClientId] = useState('');
  const [useCase, setUseCase] = useState('');
  const [actorId, setActorId] = useState('');
  const [creating, setCreating] = useState(false);

  const clientName = (id?: string) => clients.find((c) => c.id === id)?.name ?? '';
  const actorName = (id?: string) => actors.find((a) => a.id === id)?.name ?? '';
  const carName = (id?: string) => {
    const c = cars.find((x) => x.id === id);
    return c ? `${c.brand} ${c.model}` : '';
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects
      .filter((p) => !clientId || p.clientId === clientId)
      .filter((p) => !actorId || p.actorId === actorId)
      .filter((p) => !useCase || p.useCases.includes(useCase as CategoryId))
      .filter((p) => {
        if (!needle) return true;
        const hay = [
          p.name,
          clientName(p.clientId),
          actorName(p.actorId),
          carName(p.carId),
          ...p.useCases.map((u) => CATEGORIES.find((c) => c.id === u)?.label ?? u),
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [projects, q, clientId, actorId, useCase, clients, actors, cars]);

  const totalSpend = projects.reduce((sum, p) => sum + (p.totalCostInr ?? 0), 0);

  const create = async () => {
    setCreating(true);
    const p = { ...emptyProject(), name: 'Untitled project' };
    const r = await api.projects.save(p);
    setCreating(false);
    if (isApiError(r)) return;
    await refresh();
    go('projects', r.id);
  };

  return (
    <Panel
      title="Projects"
      step={`${filtered.length} of ${projects.length}${
        totalSpend ? ` · ${formatInr(totalSpend)} spent` : ''
      }`}
      actions={
        <button className="btn small primary" type="button" disabled={creating} onClick={create}>
          {creating ? 'Creating…' : 'New project'}
        </button>
      }
    >
      <div className="section-desc">
        One project = one video. Every project is filed under its client, use case and actor so you can find it
        again fast.
      </div>

      <div className="row4">
        <Field label="Search">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, client, car…" />
        </Field>
        <Field label="Client">
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Use case">
          <select value={useCase} onChange={(e) => setUseCase(e.target.value)}>
            <option value="">All use cases</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Actor">
          <select value={actorId} onChange={(e) => setActorId(e.target.value)}>
            <option value="">All actors</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {filtered.length === 0 ? (
        <Empty icon="🎬">
          {projects.length === 0 ? 'No projects yet — create one to get started.' : 'Nothing matches those filters.'}
        </Empty>
      ) : (
        <div className="proj-grid">
          {filtered.map((p) => (
            <button key={p.id} className="proj-card" type="button" onClick={() => go('projects', p.id)}>
              <div className="proj-top">
                <b>{p.name || 'Untitled project'}</b>
                <span className={`badge s-${p.status}`}>{STATUS_LABEL[p.status]}</span>
              </div>
              <div className="proj-tags">
                {clientName(p.clientId) && <span className="chip">{clientName(p.clientId)}</span>}
                {carName(p.carId) && <span className="chip">{carName(p.carId)}</span>}
                {actorName(p.actorId) && <span className="chip">{actorName(p.actorId)}</span>}
                {p.useCases.map((u) => (
                  <span className="chip accent" key={u}>
                    {CATEGORIES.find((c) => c.id === u)?.label ?? u}
                  </span>
                ))}
              </div>
              <div className="proj-foot">
                {p.spec.durationAuto ? 'Auto length' : `${p.spec.durationSec}s`} · {p.spec.aspect} · updated{' '}
                {new Date(p.updatedAt).toLocaleDateString()}
                {!!p.generationCount && (
                  <>
                    {' · '}
                    <b>
                      {p.generationCount} video{p.generationCount > 1 ? 's' : ''} ·{' '}
                      {formatInr(p.totalCostInr ?? 0)}
                    </b>
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}
