import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORIES,
  NARRATION,
  buildPrompt,
  buildBeats,
  buildContext,
  suggestDuration,
  clampPace,
  runChecks,
  estimateCost,
  isPromptOnly,
  composeBrief,
  projectVehicleIds,
  brandMatches,
  formatFit,
  formatFitSummary,
  defaultFooterText,
  type CategoryId,
  type Project,
  type ProjectVideoSpec,
  renderResolution,
  priceFor,
  colourName,
  categoryValues,
} from '@ava/shared';
import { useApp, api, projectTabId } from '../state/appStore.js';
import { Field, Panel, ImageUpload, Thumb, Confirm, Banner, Collapse } from '../components/ui.js';
import { ListField } from '../components/ListField.js';
import { isApiError } from '../lib/client.js';
// `api` above is the library CRUD client; this one owns generation + scripting.
import { api as genApi } from '../lib/api.js';
import { Storyboard } from '../components/Storyboard.js';
import { OutputPanel } from '../components/OutputPanel.js';
import { GenerationPanel } from '../components/GenerationPanel.js';

export function ProjectEditor({ projectId }: { projectId: string }) {
  const { projects, clients, actors, cars, instructions, languages, models, refresh, go, closeTab } =
    useApp();
  const stored = projects.find((p) => p.id === projectId);
  const [project, setProject] = useState<Project | null>(stored ?? null);
  const [savedAt, setSavedAt] = useState<number>(0);
  const dirty = useRef(false);
  /** Set once the project is being deleted, so no pending autosave writes it back. */
  const removed = useRef(false);

  useEffect(() => {
    if (stored && !project) setProject(stored);
  }, [stored, project]);

  // Autosave a moment after edits settle.
  useEffect(() => {
    if (!project || !dirty.current || removed.current) return;
    const t = setTimeout(async () => {
      if (removed.current) return;
      const r = await api.projects.save(project);
      dirty.current = false;
      if (!isApiError(r)) {
        setSavedAt(Date.now());
        await refresh();
      }
    }, 900);
    return () => clearTimeout(t);
  }, [project, refresh]);

  const set = (p: Partial<Project>) => {
    dirty.current = true;
    setProject((cur) => (cur ? { ...cur, ...p, updatedAt: Date.now() } : cur));
  };
  const setSpec = (p: Partial<ProjectVideoSpec>) => project && set({ spec: { ...project.spec, ...p } });

  const client = clients.find((c) => c.id === project?.clientId) ?? null;
  const footerPreview = client ? client.footerText?.trim() || defaultFooterText(client) : '';
  const actor = actors.find((a) => a.id === project?.actorId) ?? null;
  const vehicleIds = project ? projectVehicleIds(project) : [];
  const vehicles = vehicleIds.map((id) => cars.find((c) => c.id === id)).filter(Boolean) as typeof cars;
  const car = vehicles[0] ?? null;

  const language =
    languages.find((l) => l.id === project?.spec.languageId && l.enabled !== false) ??
    languages.find((l) => l.isDefault && l.enabled !== false) ??
    languages.find((l) => l.enabled !== false) ??
    null;

  const brief = useMemo(
    () => (project ? composeBrief(project, { client, actor, vehicles, instructions, language, library: cars }) : null),
    [project, client, actor, vehicles, instructions, language, cars],
  );

  const built = useMemo(
    () => (brief ? buildPrompt(brief, { sceneOverrides: project?.sceneEdits ?? {} }) : null),
    [brief, project?.sceneEdits],
  );

  // What the story needs at a natural read — the length "Auto" stands for.
  const suggestedLength = useMemo(() => (brief ? suggestDuration(brief) : 0), [brief]);

  // Scenes the designer deleted, named so they can be put back.
  const deletedScenes = useMemo(() => {
    const omitted = new Set(brief?.omitScenes ?? []);
    if (!brief || !omitted.size) return [];
    return buildBeats(buildContext({ ...brief, omitScenes: [] }))
      .filter((b) => b.key && omitted.has(b.key))
      .map((b) => ({ key: b.key!, title: b.title, cat: b.cat ?? '' }));
  }, [brief]);

  /**
   * Storyboard edits filed under scene keys. Edits made before scenes had keys are
   * filed by scene position, which moves the moment a scene is deleted. They are
   * read by position as they are, and re-filed under keys only when something is
   * next written — so opening a project never changes what is saved.
   */
  const keyedEdits = (edits: Project['sceneEdits']): Project['sceneEdits'] => {
    const keys = Object.keys(edits);
    if (!keys.length || !keys.every((k) => /^\d+$/.test(k)) || !built?.scenePlan) return edits;
    const next: Project['sceneEdits'] = {};
    for (const [k, edit] of Object.entries(edits)) {
      const key = built.scenePlan.scenes[Number(k)]?.beat.key;
      if (key) next[key] = edit;
    }
    return next;
  };
  const promptOnly = project ? isPromptOnly(project.useCases) : false;
  const presenterPicked = (project?.useCases ?? []).filter(
    (id) => CATEGORIES.find((c) => c.id === id)?.mode === 'presenter',
  );
  const activeModel =
    models.find((m) => m.id === project?.spec.modelId) ??
    models.find((m) => m.isDefault && m.enabled !== false) ??
    models.find((m) => m.enabled !== false) ??
    null;

  const preflight = useMemo(
    () =>
      brief
        ? runChecks(brief, { sceneOverrides: project?.sceneEdits ?? {}, model: activeModel, models })
        : null,
    [brief, project?.sceneEdits, activeModel, models],
  );

  // Clip length is a capability of the model, not a taste decision, so switching
  // model snaps it to that model's cap. This is what makes picking Seedance 2.5
  // actually render a 30s video in one call instead of splitting it into four.
  const modelCap = activeModel?.maxClipSec;
  const modelFloor = activeModel?.minClipSec;
  useEffect(() => {
    if (!project || modelCap == null || modelFloor == null) return;
    const want = Math.max(modelFloor, modelCap);
    if (want !== project.spec.maxChunkSec) {
      set({ spec: { ...project.spec, maxChunkSec: want } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModel?.id, modelCap, modelFloor]);

  // The script is a required step for a good result, and it lives inside the
  // collapsed storyboard — so a project that is missing one opens it. Latched:
  // once open it stays open, rather than snapping shut as the script lands.
  const scriptMissing = Boolean(
    preflight?.checks.some((c) => c.code === 'no-spoken-script' || c.code === 'no-pronunciation-spelling'),
  );
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  useEffect(() => {
    if (scriptMissing) setStoryboardOpen(true);
  }, [scriptMissing]);

  /** Fill every spoken scene with a real line, then let the designer edit them. */
  const writeScript = async (): Promise<string> => {
    if (!brief || !project) return 'Fill in the brief first.';
    const r = await genApi.script(brief, language?.id, project.id);
    if (isApiError(r)) return `${r.code}: ${r.message}`;
    if (!r.lines.length) return 'No spoken scenes to write for.';
    const next = { ...keyedEdits(project.sceneEdits) };
    for (const { index, key, line, say } of r.lines) {
      const k = key ?? built?.scenePlan.scenes[index]?.beat.key ?? String(index);
      next[k] = { ...next[k], dialogue: line, phonetic: say };
    }
    // The angle is saved with the copy: it is what the lines are arguing, and
    // judging a line without it is judging half the work.
    set({ sceneEdits: next, scriptAngle: r.angle });
    return `Wrote ${r.lines.length} line${r.lines.length > 1 ? 's' : ''} with ${r.model} — angle, draft, then an edit pass. Read them through and fix anything that sounds off.`;
  };

  /** Re-apply the current pronunciation guide without rewriting the copy. */
  const redoPhonetics = async (): Promise<string> => {
    if (!project) return 'Open a project first.';
    // Sent by position in this list, and filed back under each scene's key.
    const edits = keyedEdits(project.sceneEdits);
    const entries = Object.entries(edits).filter(([, v]) => !v.deleted && (v.dialogue ?? '').trim());
    const lines = entries.map(([, v], index) => ({ index, line: (v.dialogue ?? '').trim() }));
    if (!lines.length) return 'No written lines yet — write the script first.';
    const r = await genApi.phonetics(lines, language?.id);
    if (isApiError(r)) return `${r.code}: ${r.message}`;
    const next = { ...edits };
    for (const { index, say } of r.lines) {
      const key = entries[index]?.[0];
      if (key) next[key] = { ...next[key], phonetic: say };
    }
    set({ sceneEdits: next });
    return `Re-applied the ${r.language} guide to ${r.lines.length} line${r.lines.length > 1 ? 's' : ''}. The copy is unchanged.`;
  };

  /** Take a scene out of the film. A length set by hand gives up that scene's seconds. */
  const deleteScene = (key: string) => {
    if (!project) return;
    const sc = built?.scenePlan.scenes.find((s) => s.beat.key === key);
    const spec =
      !project.spec.durationAuto && sc
        ? {
            ...project.spec,
            durationSec: Math.max(6, Math.round(project.spec.durationSec - sc.duration * clampPace(project.spec.pace))),
          }
        : project.spec;
    const edits = keyedEdits(project.sceneEdits);
    set({ spec, sceneEdits: { ...edits, [key]: { ...edits[key], deleted: true } } });
  };

  const restoreScene = (key: string) => {
    if (!project) return;
    const next = { ...project.sceneEdits };
    const rest = { ...next[key] };
    delete rest.deleted;
    if (Object.values(rest).some((v) => v !== undefined)) next[key] = rest;
    else delete next[key];
    set({ sceneEdits: next });
  };

  const cost = useMemo(
    () =>
      brief && !promptOnly
        ? estimateCost(brief, activeModel ? { usdPerSecond: priceFor(activeModel, brief.resolution ?? '720p') } : {})
        : null,
    [brief, promptOnly, activeModel],
  );

  if (!project) {
    // A tab can outlive its project — deleted from another tab, say. Say so
    // rather than sitting on a spinner forever.
    const gone = projects.length > 0 && !stored;
    return (
      <Panel title="Project">
        {gone ? (
          <>
            <div className="hint">This project no longer exists — it was deleted.</div>
            <button
              className="btn small"
              type="button"
              style={{ marginTop: 8 }}
              onClick={() => closeTab(projectTabId(projectId))}
            >
              Close tab
            </button>
          </>
        ) : (
          <div className="hint">Loading…</div>
        )}
      </Panel>
    );
  }

  const fit = formatFit(brief?.durationSec ?? project.spec.durationSec, project.spec.aspect);
  const parts = built?.parts ?? [];
  const sells = client?.vehicleKind ?? 'car';
  const pickableVehicles = cars.filter(
    (c) => (c.kind ?? 'car') === sells && (!client?.brand || brandMatches(c.brand, client.brand)),
  );
  const otherVehicles = cars.filter((c) => !pickableVehicles.includes(c));

  const selectedCar = car;
  const variants = selectedCar?.variants ?? [];
  const colours = selectedCar?.colours ?? [];

  const toggleUseCase = (id: CategoryId) =>
    set({
      useCases: project.useCases.includes(id)
        ? project.useCases.filter((u) => u !== id)
        : [...project.useCases, id],
    });

  const setField = (cat: CategoryId, field: string, value: string) =>
    set({
      fieldValues: { ...project.fieldValues, [cat]: { ...(project.fieldValues[cat] ?? {}), [field]: value } },
    });

  /**
   * Several keys at once, written over the category's values as the editor shows
   * them. For offers saved in the old fixed boxes that matters: the first edit
   * saves every translated offer row, not just the one being typed into — writing
   * one row alone would switch the translation off and lose the others.
   */
  const setFields = (cat: CategoryId, patch: Record<string, string>) =>
    set({
      fieldValues: {
        ...project.fieldValues,
        [cat]: { ...categoryValues(cat, project.fieldValues[cat] ?? {}), ...patch },
      },
    });

  return (
    <div className="editor-page">
      <div className="crumbs">
        <button className="btn ghost small" type="button" onClick={() => go('projects', null)}>
          ← All projects
        </button>
        <span className="hint">
          {savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : 'Changes save automatically'}
        </span>
        <Confirm
          onConfirm={async () => {
            removed.current = true;
            dirty.current = false;
            const r = await api.projects.remove(project.id);
            if (isApiError(r)) {
              // Said out loud: a delete that fails quietly looks exactly like one that worked.
              removed.current = false;
              window.alert(`Could not delete this project: ${r.message}`);
              return;
            }
            await refresh();
            closeTab(projectTabId(project.id));
          }}
        >
          Delete project
        </Confirm>
      </div>

      <div className="grid">
        <div className="left-col">
          <Panel title="1. Project" step="Name, brief and tags">
            <Field label="Project name">
              <input
                value={project.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Sterling Hyundai — Creta feature reel"
              />
            </Field>
            <Field
              label="Your brief / prompt"
              hint="Free-text steer. Added to the master prompt on top of the structured brief."
            >
              <textarea
                value={project.prompt ?? ''}
                onChange={(e) => set({ prompt: e.target.value })}
                placeholder="e.g. Lead on safety, keep it warm and family-first. Show the delivery bay at the end."
              />
            </Field>
            <div className="row3">
              <Field label="Client">
                <select value={project.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Actor">
                <select value={project.actorId ?? ''} onChange={(e) => set({ actorId: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {actors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Vehicles"
                hint={
                  vehicleIds.length > 1
                    ? `${vehicleIds.length} models — the first is the hero and carries the variant and colour.`
                    : client?.brand
                      ? `${client.brand} ${client.vehicleKind === 'bike' ? 'bikes & scooters' : 'cars'} in your library. Leave empty to feature the whole range.`
                      : 'Leave empty to feature the whole range.'
                }
              >
                <details className="vehpick">
                  <summary>
                    {vehicleIds.length === 0
                      ? '— whole range —'
                      : vehicles.map((v) => `${v.brand} ${v.model}`).join(', ') || `${vehicleIds.length} selected`}
                  </summary>
                  <div className="vehlist">
                    {pickableVehicles.length === 0 && (
                      <div className="hint">
                        Nothing in the library for {client?.brand || 'this client'} yet — sync the brand in
                        Vehicles.
                      </div>
                    )}
                    {pickableVehicles.map((c) => {
                      const on = vehicleIds.includes(c.id);
                      return (
                        <label key={c.id} className={`vehrow${on ? ' on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => {
                              const next = on ? vehicleIds.filter((x) => x !== c.id) : [...vehicleIds, c.id];
                              set({
                                carIds: next,
                                carId: next[0],
                                // Variant and colour belong to the hero, so they
                                // stop meaning anything once it changes.
                                carVariant: next[0] === vehicleIds[0] ? project.carVariant : undefined,
                                carColour: next[0] === vehicleIds[0] ? project.carColour : undefined,
                              });
                            }}
                          />
                          <span>
                            {c.brand} {c.model}
                          </span>
                        </label>
                      );
                    })}
                    {otherVehicles.length > 0 && (
                      <details className="vehother">
                        <summary>Other brands in the library ({otherVehicles.length})</summary>
                        {otherVehicles.map((c) => {
                          const on = vehicleIds.includes(c.id);
                          return (
                            <label key={c.id} className={`vehrow${on ? ' on' : ''}`}>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => {
                                  const next = on ? vehicleIds.filter((x) => x !== c.id) : [...vehicleIds, c.id];
                                  set({ carIds: next, carId: next[0] });
                                }}
                              />
                              <span>
                                {c.brand} {c.model}
                              </span>
                            </label>
                          );
                        })}
                      </details>
                    )}
                  </div>
                </details>
              </Field>
            </div>
            {selectedCar && (
              <div className="row2">
                <Field label="Variant">
                  <select
                    value={project.carVariant ?? ''}
                    onChange={(e) => set({ carVariant: e.target.value || undefined })}
                  >
                    <option value="">Any variant</option>
                    {variants.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                        {v.price ? ` — ₹${v.price}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Colour">
                  <select
                    value={project.carColour ?? ''}
                    onChange={(e) => set({ carColour: e.target.value || undefined })}
                  >
                    <option value="">Any colour</option>
                    {colours.map((c) => (
                      <option key={c.name} value={c.name}>
                        {colourName(c.name)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </Panel>

          <Panel
            title="2. Use case"
            step={promptOnly ? 'Prompt-only — no video generation' : 'Composable — pick 1 or more'}
          >
            {project.useCases.length >= 3 && (
              <Banner kind="warn">
                {project.useCases.length} use cases in one video. Their beats interleave, so the story gets
                disjointed — two is usually the most that still reads as one ad.
              </Banner>
            )}
            {promptOnly && (
              <Banner kind="warn">
                Presenter-led use cases can't be generated automatically — picking one makes the whole project
                prompt-only.
              </Banner>
            )}
            <div className="cat-grid">
              {CATEGORIES.map((c) => {
                const on = project.useCases.includes(c.id);
                return (
                  <div key={c.id} className={`cat${on ? ' on' : ''}`} onClick={() => toggleUseCase(c.id)}>
                    {c.mode !== 'automated' && <span className="m">Prompt-only</span>}
                    <span className="n">{c.label}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="3. Video" step="The essentials — everything else has a sensible default">
            <div className="row3">
              <Field label="Length">
                <div className="length-pick">
                  <select
                    value={project.spec.durationAuto ? 'auto' : 'custom'}
                    onChange={(e) =>
                      setSpec(
                        e.target.value === 'auto'
                          ? { durationAuto: true }
                          : { durationAuto: false, durationSec: suggestedLength || project.spec.durationSec },
                      )
                    }
                  >
                    <option value="auto">Auto{suggestedLength ? ` — ${suggestedLength}s` : ''}</option>
                    <option value="custom">Set by hand</option>
                  </select>
                  {!project.spec.durationAuto && (
                    <input
                      type="number"
                      min={6}
                      max={120}
                      value={project.spec.durationSec}
                      onChange={(e) => setSpec({ durationSec: Number(e.target.value) })}
                    />
                  )}
                </div>
              </Field>
              <Field label="Aspect ratio">
                <select
                  value={project.spec.aspect}
                  onChange={(e) => setSpec({ aspect: e.target.value as ProjectVideoSpec['aspect'] })}
                >
                  <option value="9:16">Vertical 9:16</option>
                  <option value="1:1">Square 1:1</option>
                  <option value="16:9">Horizontal 16:9</option>
                </select>
              </Field>
              <Field
                label="Language"
                hint={
                  language
                    ? `Spoken and written in ${language.name}. Its rules live in the Languages section.`
                    : 'No languages configured — add one in Languages.'
                }
              >
                <select
                  value={project.spec.languageId ?? ''}
                  onChange={(e) => setSpec({ languageId: e.target.value || undefined })}
                >
                  <option value="">Default language</option>
                  {languages
                    .filter((l) => l.enabled !== false)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                        {l.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                </select>
              </Field>
              <Field
                label="Model"
                hint={
                  activeModel
                    ? `${activeModel.minClipSec}–${activeModel.maxClipSec}s per clip · $${activeModel.usdPerSecond}/s`
                    : 'No models registered — add one in APIs & models.'
                }
              >
                <select
                  value={project.spec.modelId ?? ''}
                  onChange={(e) => setSpec({ modelId: e.target.value || undefined })}
                >
                  <option value="">Default model</option>
                  {models
                    .filter((m) => m.enabled !== false)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <div className="hint" style={{ marginTop: -4 }}>
              {formatFitSummary(fit)}. {fit.notes.join(' ')}
            </div>

            <div style={{ marginTop: 14 }}>
              <Collapse title="Narration &amp; audio" hint={NARRATION[project.spec.narration].label}>
                <div className="row2">
                  <Field label="Narration mode" hint={NARRATION[project.spec.narration].hint}>
                    <select
                      value={project.spec.narration}
                      onChange={(e) => setSpec({ narration: e.target.value as ProjectVideoSpec['narration'] })}
                    >
                      {Object.values(NARRATION).map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Music / audio bed">
                    <input value={project.spec.music} onChange={(e) => setSpec({ music: e.target.value })} />
                  </Field>
                </div>
              </Collapse>

              <Collapse title="On-screen text &amp; end card">
                <div className="row2">
                  <Field label="On-screen text">
                    <select
                      value={project.spec.textLang}
                      onChange={(e) => setSpec({ textLang: e.target.value as ProjectVideoSpec['textLang'] })}
                    >
                      <option value="english">English only</option>
                      <option value="mixed">Hindi + English</option>
                      <option value="hindi">Devanagari-led</option>
                    </select>
                  </Field>
                  <Field label="Copy tone">
                    <select
                      value={project.spec.captionStyle}
                      onChange={(e) =>
                        setSpec({ captionStyle: e.target.value as ProjectVideoSpec['captionStyle'] })
                      }
                    >
                      <option value="Long Narrative">Long Narrative</option>
                      <option value="Short Punchy">Short Punchy</option>
                      <option value="Structured">Structured minimal</option>
                    </select>
                  </Field>
                </div>
                <Field label="Primary CTA">
                  <input value={project.spec.cta} onChange={(e) => setSpec({ cta: e.target.value })} />
                </Field>
                <Field label="Footer strip" hint="Set once per client, in the Clients section.">
                  <input readOnly value={client ? footerPreview : 'Select a client to set the footer'} />
                </Field>
                <div className="check-row">
                  <input
                    type="checkbox"
                    id="pe_endcard"
                    checked={project.spec.endCardOn}
                    onChange={(e) => setSpec({ endCardOn: e.target.checked })}
                  />
                  <label htmlFor="pe_endcard">End on a dealer details + CTA card</label>
                </div>
                {project.spec.endCardOn && (
                  <Field label="End card content" hint="One line per row, or separate with |. Composited, not generated.">
                    <textarea value={project.spec.endCard} onChange={(e) => setSpec({ endCard: e.target.value })} />
                  </Field>
                )}
              </Collapse>

              <Collapse title="Advanced" hint="Look, resolution, clip length">
                <Field label="Visual style">
                  <input
                    value={project.spec.visualStyle}
                    onChange={(e) => setSpec({ visualStyle: e.target.value })}
                  />
                </Field>
                <div className="row2">
                  <Field
                    label="Resolution"
                    hint={(() => {
                      if (!activeModel) return undefined;
                      const r = renderResolution(activeModel.modelId, project.spec.resolution, activeModel.resolutions);
                      return r.upscale
                        ? `${activeModel.name} renders ${r.render}; the finished video is upscaled to ${project.spec.resolution} in post.`
                        : `${activeModel.name} renders ${r.render} natively.`;
                    })()}
                  >
                    <select
                      value={project.spec.resolution}
                      onChange={(e) => setSpec({ resolution: e.target.value as ProjectVideoSpec['resolution'] })}
                    >
                      <option value="1080p">1080p — Full HD</option>
                      <option value="720p">720p</option>
                      <option value="480p">480p</option>
                    </select>
                  </Field>
                  <Field
                    label="Max seconds per clip"
                    hint={activeModel ? `This model caps at ${activeModel.maxClipSec}s.` : undefined}
                  >
                    <input
                      type="number"
                      min={activeModel?.minClipSec ?? 3}
                      max={activeModel?.maxClipSec ?? 30}
                      value={project.spec.maxChunkSec}
                      onChange={(e) =>
                        setSpec({
                          maxChunkSec: Math.min(
                            Number(e.target.value),
                            activeModel?.maxClipSec ?? Number(e.target.value),
                          ),
                        })
                      }
                    />
                  </Field>
                </div>
              </Collapse>
            </div>
          </Panel>

          <Panel title="4. Reference images" step="Pulled in automatically from the client and car">
            <div className="section-desc">
              The client's photos and the car's image set are pulled in automatically. Add anything extra this
              particular video needs.
            </div>
            <div className="thumbs">
              {project.extraRefs.map((r) => (
                <Thumb
                  key={r.refId}
                  img={r}
                  onRemove={() => set({ extraRefs: project.extraRefs.filter((x) => x.refId !== r.refId) })}
                />
              ))}
              <ImageUpload
                label={`${project.name || 'Project'} — reference`}
                onUploaded={(img) => set({ extraRefs: [...project.extraRefs, img] })}
                buttonText="Add reference"
              />
            </div>
            {brief && brief.attachments.length > 0 && (
              <div className="hint" style={{ marginTop: 8 }}>
                {brief.attachments.length} reference image{brief.attachments.length === 1 ? '' : 's'} in scope
                (car + client + extras).
              </div>
            )}
          </Panel>

          {project.useCases.length > 0 && (
            <Panel title="5. Use-case details" step="Shown for selected use cases">
              {project.useCases.map((id) => {
                const cat = CATEGORIES.find((c) => c.id === id)!;
                const values = categoryValues(id, project.fieldValues[id] ?? {});
                const mandatory = new Set(cat.mandatory.map((m) => m.id));
                return (
                  <div key={id} style={{ marginBottom: 14 }}>
                    <h3 style={{ marginBottom: 6 }}>{cat.label}</h3>
                    <div className="hint" style={{ marginBottom: 10 }}>
                      {cat.purpose}
                    </div>
                    {cat.fields.map((f) => {
                      if (f.showIf && !values[f.showIf]) return null;
                      const label = `${f.label}${
                        mandatory.has(f.id) || cat.mandatory.some((m) => m.list === f.id) ? ' *' : ''
                      }`;
                      if (f.type === 'list' && f.list) {
                        return (
                          <ListField
                            key={f.id}
                            field={f}
                            label={label}
                            values={values}
                            onPatch={(patch) => setFields(id, patch)}
                          />
                        );
                      }
                      if (f.type === 'checkbox') {
                        return (
                          <div className="check-row" key={f.id}>
                            <input
                              type="checkbox"
                              id={`${id}_${f.id}`}
                              checked={!!values[f.id]}
                              onChange={(e) => setField(id, f.id, e.target.checked ? 'yes' : '')}
                            />
                            <label htmlFor={`${id}_${f.id}`}>{f.label}</label>
                          </div>
                        );
                      }
                      return (
                        <Field key={f.id} label={label}>
                          {f.type === 'textarea' ? (
                            <textarea
                              value={values[f.id] ?? ''}
                              placeholder={f.ph}
                              onChange={(e) => setField(id, f.id, e.target.value)}
                            />
                          ) : f.type === 'select' ? (
                            <select value={values[f.id] ?? ''} onChange={(e) => setField(id, f.id, e.target.value)}>
                              <option value="">Select…</option>
                              {(f.options ?? []).map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={values[f.id] ?? ''}
                              placeholder={f.ph}
                              onChange={(e) => setField(id, f.id, e.target.value)}
                            />
                          )}
                        </Field>
                      );
                    })}
                  </div>
                );
              })}
            </Panel>
          )}

          {built?.scenePlan && built.scenePlan.scenes.length > 0 && (
            <Collapse
              title="Storyboard"
              open={storyboardOpen}
              hint={
                scriptMissing
                  ? 'Needs a script — open and press Write the script'
                  : `${built.scenePlan.scenes.length} scenes · ${built.scenePlan.parts} segment${
                      built.scenePlan.parts > 1 ? 's' : ''
                    } · edit any scene's script or shot`
              }
            >
              <Storyboard
                scenePlan={built.scenePlan}
                sceneEdits={project.sceneEdits}
                narration={project.spec.narration}
                onEditScene={(key, patch) => {
                  const edits = keyedEdits(project.sceneEdits);
                  set({ sceneEdits: { ...edits, [key]: { ...edits[key], ...patch } } });
                }}
                onClearEdits={() => set({ sceneEdits: {} })}
                attachments={brief?.attachments ?? []}
                angle={project.scriptAngle}
                onWriteScript={writeScript}
                onRedoPhonetics={language?.needsPhonetics === false ? undefined : redoPhonetics}
                languageName={language?.name}
                vehicle={brief?.vehicleKind ?? 'car'}
                length={{
                  auto: project.spec.durationAuto === true,
                  seconds: project.spec.durationSec,
                  suggested: suggestedLength,
                  pace: clampPace(project.spec.pace),
                  endCard: project.spec.endCardOn ? 3 : 0,
                }}
                onLength={(patch) => setSpec(patch)}
                deletedScenes={deletedScenes}
                onDeleteScene={deleteScene}
                onRestoreScene={restoreScene}
              />
            </Collapse>
          )}
        </div>

        <div className="right-col">
          {!project.clientId && <Banner kind="warn">No client selected — footer and end card will be empty.</Banner>}
          {preflight && (
            <OutputPanel parts={parts} preflight={preflight} cost={cost} promptOnly={promptOnly} />
          )}
          {promptOnly && parts.length > 0 && (
            <Panel title="Generate &amp; preview" step="Unavailable for this mix">
              <Banner kind="warn">
                This project is prompt-only because{' '}
                <b>
                  {presenterPicked
                    .map((id) => CATEGORIES.find((c) => c.id === id)?.label ?? id)
                    .join(' and ')}
                </b>{' '}
                {presenterPicked.length > 1 ? 'are' : 'is'} presenter-led.
              </Banner>
              <div className="section-desc">
                No video model can lip-sync a named presenter from a photo yet, so these use cases stop at the
                master prompt — copy it into Lumina to finish there. Remove{' '}
                {presenterPicked.length > 1 ? 'them' : 'it'} to generate automatically.
              </div>
              <div className="toolbar" style={{ marginTop: 0 }}>
                {presenterPicked.map((id) => (
                  <button
                    key={id}
                    className="btn small"
                    type="button"
                    onClick={() => set({ useCases: project.useCases.filter((u) => u !== id) })}
                  >
                    Remove “{CATEGORIES.find((c) => c.id === id)?.label ?? id}”
                  </button>
                ))}
              </div>
            </Panel>
          )}

          {brief && !promptOnly && parts.length > 0 && preflight && (
            <GenerationPanel
              brief={brief}
              parts={parts}
              scenePlan={built?.scenePlan ?? null}
              canGenerate={preflight.canGenerate}
              needsCostConfirm={!!cost?.needsConfirmation}
              costInr={cost?.inr ?? 0}
              modelId={project.spec.modelId ?? activeModel?.id}
              modelLabel={activeModel?.name}
              project={{ id: project.id, name: project.name }}
              sceneOverrides={project.sceneEdits}
              resolution={project.spec.resolution}
              onGenerated={(jobId, finalUrl) =>
                set({ status: 'generated', lastJobId: jobId, lastFinalUrl: finalUrl ?? undefined })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
