import { useMemo, useState } from 'react';
import {
  CATEGORIES,
  PROJECT_STAGES,
  projectStage,
  emptyProject,
  formatInr,
  packOf,
  type CategoryId,
  type Project,
  type ProjectStage,
} from '@ava/shared';
import { useApp, api } from '../state/appStore.js';
import { Field, Empty } from '../components/ui.js';
import { isApiError } from '../lib/client.js';

const STATUS_LABEL: Record<Project['status'], string> = {
  draft: 'Draft',
  ready: 'Ready',
  generating: 'Generating',
  generated: 'Generated',
  failed: 'Failed',
};

type View = 'board' | 'list';

const readView = (): View => {
  try {
    return localStorage.getItem('ava.projects.view') === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
};

export function ProjectsSection() {
  const { projects, clients, actors, cars, refresh, go } = useApp();
  const [q, setQ] = useState('');
  const [clientId, setClientId] = useState('');
  const [useCase, setUseCase] = useState('');
  const [actorId, setActorId] = useState('');
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<View>(readView);
  /** Where a card has just been dropped, held until the server agrees. */
  const [moved, setMoved] = useState<Record<string, ProjectStage>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<ProjectStage | null>(null);

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

  const pickView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem('ava.projects.view', v);
    } catch {
      /* storage unavailable — the choice lasts this session */
    }
  };

  const create = async () => {
    setCreating(true);
    const p = { ...emptyProject(), name: 'Untitled project' };
    const r = await api.projects.save(p);
    setCreating(false);
    if (isApiError(r)) return;
    await refresh();
    go('projects', r.id);
  };

  const stageOf = (p: Project): ProjectStage => moved[p.id] ?? projectStage(p);

  const forget = (id: string) =>
    setMoved((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });

  /** Move a project to another column. The card moves first; the write follows. */
  const move = async (p: Project, to: ProjectStage) => {
    if (stageOf(p) === to) return;
    setMoved((m) => ({ ...m, [p.id]: to }));
    const r = await api.projects.patch(p.id, { stage: to, updatedAt: Date.now() });
    if (isApiError(r)) {
      forget(p.id);
      window.alert(`Could not move this project: ${r.message}`);
      return;
    }
    await refresh();
    forget(p.id);
  };

  const tags = (p: Project) => (
    <>
      {packOf(p) === 'trial' && <span className="chip">Trial pack</span>}
      {clientName(p.clientId) && <span className="chip">{clientName(p.clientId)}</span>}
      {carName(p.carId) && <span className="chip">{carName(p.carId)}</span>}
      {p.useCases.map((u) => (
        <span className="chip accent" key={u}>
          {CATEGORIES.find((c) => c.id === u)?.label ?? u}
        </span>
      ))}
    </>
  );

  const filters = (
    <div className="list-head">
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
  );

  const board = (
    <div className="board">
      {PROJECT_STAGES.map((st, col) => {
        const cards = filtered.filter((p) => stageOf(p) === st.id);
        return (
          <section
            key={st.id}
            className={`kcol s-${st.id}${overStage === st.id ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overStage !== st.id) setOverStage(st.id);
            }}
            onDragLeave={() => setOverStage((cur) => (cur === st.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              setOverStage(null);
              setDragId(null);
              const id = e.dataTransfer.getData('text/plain');
              const p = projects.find((x) => x.id === id);
              if (p) void move(p, st.id);
            }}
          >
            <header className="kcol-head" title={st.hint}>
              <span className="kcol-dot" aria-hidden />
              <b>{st.label}</b>
              <em>{st.hint}</em>
              <span className="kcol-count">{cards.length}</span>
            </header>
            <div className="klist">
              {cards.length === 0 && <div className="kcol-empty">Drop a project here</div>}
              {cards.map((p) => (
                <article
                  key={p.id}
                  className={`kcard${dragId === p.id ? ' dragging' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', p.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragId(p.id);
                  }}
                  onDragEnd={() => setDragId(null)}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button')) return;
                    go('projects', p.id);
                  }}
                >
                  <div className="kcard-top">
                    <button className="kcard-title" type="button" onClick={() => go('projects', p.id)}>
                      {p.name || 'Untitled project'}
                    </button>
                    {(p.status === 'generating' || p.status === 'failed') && (
                      <span className={`badge s-${p.status}`}>{STATUS_LABEL[p.status]}</span>
                    )}
                  </div>
                  <div className="kcard-tags">{tags(p)}</div>
                  <div className="kcard-foot">
                    <span>
                      {p.generationCount
                        ? `${p.generationCount} video${p.generationCount > 1 ? 's' : ''} · ${formatInr(
                            p.totalCostInr ?? 0,
                          )}`
                        : `${p.spec.durationAuto ? 'Auto' : `${p.spec.durationSec}s`} · ${p.spec.aspect}`}
                    </span>
                    <span className="kcard-move">
                      <button
                        type="button"
                        disabled={col === 0}
                        aria-label={`Move ${p.name || 'project'} to ${PROJECT_STAGES[col - 1]?.label ?? ''}`}
                        title={col > 0 ? `Move to ${PROJECT_STAGES[col - 1]!.label}` : ''}
                        onClick={() => col > 0 && void move(p, PROJECT_STAGES[col - 1]!.id)}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        disabled={col === PROJECT_STAGES.length - 1}
                        aria-label={`Move ${p.name || 'project'} to ${PROJECT_STAGES[col + 1]?.label ?? ''}`}
                        title={
                          col < PROJECT_STAGES.length - 1 ? `Move to ${PROJECT_STAGES[col + 1]!.label}` : ''
                        }
                        onClick={() => col < PROJECT_STAGES.length - 1 && void move(p, PROJECT_STAGES[col + 1]!.id)}
                      >
                        ›
                      </button>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );

  const list = (
    <div className="proj-grid">
      {filtered.map((p) => (
        <button key={p.id} className="proj-card" type="button" onClick={() => go('projects', p.id)}>
          <div className="proj-top">
            <b>{p.name || 'Untitled project'}</b>
            <span className={`badge s-${p.status}`}>{STATUS_LABEL[p.status]}</span>
          </div>
          <div className="proj-tags">
            {tags(p)}
            {actorName(p.actorId) && <span className="chip">{actorName(p.actorId)}</span>}
          </div>
          <div className="proj-foot">
            {p.spec.durationAuto ? 'Auto length' : `${p.spec.durationSec}s`} · {p.spec.aspect} · updated{' '}
            {new Date(p.updatedAt).toLocaleDateString()}
            {!!p.generationCount && (
              <>
                {' · '}
                <b>
                  {p.generationCount} video{p.generationCount > 1 ? 's' : ''} · {formatInr(p.totalCostInr ?? 0)}
                </b>
              </>
            )}
          </div>
        </button>
      ))}
    </div>
  );

  // The search and the columns' headings stay put; only the cards move under them.
  return (
    <div className="browse">
      <div className="card">
        <div className="head">
          <div className="head-left">
            <h2>Projects</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="step">
              {filtered.length} of {projects.length}
              {totalSpend ? ` · ${formatInr(totalSpend)} spent` : ''}
            </span>
            <div className="seg quiet">
              <button type="button" className={view === 'board' ? 'on' : ''} onClick={() => pickView('board')}>
                Board
              </button>
              <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => pickView('list')}>
                List
              </button>
            </div>
            <button className="btn small primary" type="button" disabled={creating} onClick={create}>
              {creating ? 'Creating…' : 'New project'}
            </button>
          </div>
        </div>
        <div className="body tight">
          <div className="section-desc">
            One project = one video. Drag a card to say where it stands — open, in progress, in review, delivered.
          </div>
          {filters}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="browse-scroll">
          <Empty icon="🎬">
            {projects.length === 0
              ? 'No projects yet — create one to get started.'
              : 'Nothing matches those filters.'}
          </Empty>
        </div>
      ) : view === 'board' ? (
        board
      ) : (
        <div className="browse-scroll">{list}</div>
      )}
    </div>
  );
}
