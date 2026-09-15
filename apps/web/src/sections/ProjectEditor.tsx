import { useEffect, useMemo, useRef, useState } from 'react';
import {
  packOf,
  parseRupees,
  revenueMissing,
  CATEGORIES,
  NARRATION,
  buildPrompt,
  applyBriefPlan,
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
  type CarAngle,
  colourName,
  categoryValues,
  storyGuidance,
  narrationMode,
  SPEECH_RATES,
  speechRate,
  DEFAULT_WPM,
  storyTheme,
  listRows,
  usualActorFor,
  PROJECT_STAGES,
  projectStage,
  type ProjectStage,
  referencePlan,
  ROLE_LABEL,
  dealerViewLabel,
  type PlannedRef,
  remainingLabel,
} from '@ava/shared';
import { useApp, api, projectTabId } from '../state/appStore.js';
import { Field, Panel, Section, Dropdown, ImageUpload, Thumb, Confirm, Banner, Lock, useReadOnly } from '../components/ui.js';
import { ListField } from '../components/ListField.js';
import { isApiError, abs, getModelUsage, type ModelUsageItem } from '../lib/client.js';
// `api` above is the library CRUD client; this one owns generation + scripting.
import { api as genApi } from '../lib/api.js';
import { Storyboard, type LockField } from '../components/Storyboard.js';
import { OutputPanel } from '../components/OutputPanel.js';
import { GenerationPanel } from '../components/GenerationPanel.js';
import { LookPicker } from '../components/LookPicker.js';

/**
 * One line of the reference list: where it sits, what it is a picture of, and a
 * cross to hold it back.
 *
 * Holding one back is not deleting it — the photograph stays in the library and
 * stays on this list, struck through, until the cross is clicked again. It is how
 * you find out which one photograph a run keeps copying without unpicking the
 * library for every other film.
 */
function RefRow({
  entry,
  onHold,
}: {
  entry: PlannedRef;
  onHold?: (filename: string, hold: boolean) => void;
}) {
  const { photo, role, slot, held } = entry;
  const src =
    abs(photo.src ?? (photo.refId && photo.filename ? `/api/refs/${photo.refId}/${photo.filename}` : null)) ??
    undefined;
  // The label is a sentence, because the model reads it beside the image. The
  // list shows the front of it and keeps the whole thing on hover.
  const short = photo.label.split(' — ')[0] ?? photo.label;
  const tags = [
    photo.sheet ? 'a sheet of several photographs' : '',
    photo.angle ?? '',
    photo.view ? dealerViewLabel(photo.view) : '',
  ].filter(Boolean);
  return (
    <div className={`ref-row${held ? ' held' : slot === null ? ' spare' : ''}`} title={photo.label}>
      <span className="ref-slot">{held || slot === null ? '—' : slot + 1}</span>
      <span className="ref-shot">
        {photo.kind === 'reference-video' ? (
          src ? <video src={src} muted playsInline preload="metadata" /> : <span aria-hidden>▶</span>
        ) : src ? (
          <img src={src} alt="" loading="lazy" />
        ) : (
          <span aria-hidden>·</span>
        )}
      </span>
      <span className="ref-name">
        {short}
        <em>{[photo.filename, ...tags].join(' · ')}</em>
      </span>
      <span className={`ref-role ${role}`}>{ROLE_LABEL[role]}</span>
      {onHold ? (
        <button
          type="button"
          className="ref-x"
          title={held ? 'Send this again' : 'Hold this back from the next run'}
          aria-label={held ? `Send ${short} again` : `Hold back ${short}`}
          onClick={() => onHold(photo.filename, !held)}
        >
          {held ? '\u21ba' : '\u00d7'}
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

export function ProjectEditor({ projectId }: { projectId: string }) {
  const { projects, clients, actors, cars, instructions, languages, models, refresh, go, closeTab } =
    useApp();
  const readOnly = useReadOnly();
  const stored = projects.find((p) => p.id === projectId);
  const [project, setProject] = useState<Project | null>(stored ?? null);
  const [savedAt, setSavedAt] = useState<number>(0);
  const dirty = useRef(false);
  /** Set once the project is being deleted, so no pending autosave writes it back. */
  const removed = useRef(false);
  const latest = useRef(project);
  latest.current = project;
  /** Bumped when the revenue arrives from elsewhere, so the box shows it rather than what it held. */
  const [revenueSync, setRevenueSync] = useState(0);

  useEffect(() => {
    if (stored && !project) setProject(stored);
  }, [stored, project]);

  // A card moved on the board lands here too, instead of being written back by
  // this editor's next autosave.
  useEffect(() => {
    if (stored?.stage) setProject((cur) => (cur && cur.stage !== stored.stage ? { ...cur, stage: stored.stage } : cur));
  }, [stored?.stage]);

  // The pack and the revenue can be set from Analytics as well. Taken in here, so this
  // editor's next autosave does not put back what it had — unless it holds unsaved
  // edits of its own, which are newer.
  useEffect(() => {
    const cur = latest.current;
    if (!stored || !cur || dirty.current) return;
    if (cur.packType === stored.packType && (cur.campaignRevenueInr ?? 0) === (stored.campaignRevenueInr ?? 0)) return;
    setProject((c) => (c ? { ...c, packType: stored.packType, campaignRevenueInr: stored.campaignRevenueInr } : c));
    setRevenueSync((n) => n + 1);
  }, [stored?.packType, stored?.campaignRevenueInr]);

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
    // A viewer's editor changes nothing, so there is never anything waiting to be saved.
    if (readOnly) return;
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

  /**
   * Every reference in scope, in the order the model is handed them.
   *
   * Composed a second time with nothing held back, so a photograph crossed out
   * here is still listed — struck through, with a cross to put it back — rather
   * than quietly gone. The ordering is orderReferences, the same function the
   * renderer calls, so this list is the list that is sent.
   */
  const refPlan = useMemo(() => {
    if (!project) return null;
    const full = composeBrief(
      { ...project, excludedRefs: [] },
      { client, actor, vehicles, instructions, language, library: cars },
    );
    return referencePlan(full, {
      max: activeModel?.maxReferenceImages ?? 10,
      maxVideos: 3,
      held: project.excludedRefs ?? [],
    });
  }, [project, client, actor, vehicles, instructions, language, cars, activeModel]);

  /**
   * How much of today each model has left.
   *
   * Shown in the picker so the choice can be made on purpose: an earlier or a
   * cheaper model for a film that can wait, and the day's Omni requests kept for
   * the one that cannot. Read again whenever the model list changes.
   */
  const [modelUsage, setModelUsage] = useState<{ resetsAt: number; byId: Record<string, ModelUsageItem> } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    void getModelUsage().then((r) => {
      if (!live || isApiError(r)) return;
      setModelUsage({ resetsAt: r.resetsAt, byId: Object.fromEntries(r.items.map((i) => [i.id, i])) });
    });
    return () => {
      live = false;
    };
  }, [models.length]);
  const usageLabel = (id: string | undefined): string => {
    const u = id ? modelUsage?.byId[id] : undefined;
    return u && modelUsage ? remainingLabel(u, modelUsage.resetsAt) : '';
  };

  /** Hold one reference back from the next run, or send it again. */
  const holdRef = (filename: string, hold: boolean): void => {
    if (!project) return;
    const held = project.excludedRefs ?? [];
    set({ excludedRefs: hold ? [...new Set([...held, filename])] : held.filter((f) => f !== filename) });
  };

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
    preflight?.checks.some((c) => c.code === 'no-spoken-script'),
  );
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  /**
   * Which of the numbered panels are folded open, remembered on this device.
   *
   * A brief is filled once and then read a hundred times while the film is made;
   * after the first pass most of these are settled, and the useful screen is the
   * storyboard. They open by default so nothing is hidden from someone seeing the
   * project for the first time, and stay however they were left after that.
   */
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('ava.panels') ?? '{}') as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const panelOpen = (id: string): boolean => openPanels[id] ?? true;
  const setPanelOpen = (id: string, open: boolean): void =>
    setOpenPanels((was) => {
      const next = { ...was, [id]: open };
      try {
        localStorage.setItem('ava.panels', JSON.stringify(next));
      } catch {
        /* storage unavailable — the choice lasts this session */
      }
      return next;
    });
  const fold = (id: string) => ({ open: panelOpen(id), onOpenChange: (o: boolean) => setPanelOpen(id, o) });
  /** Use-case details are folded away; picking a use case opens its own block. */
  const [openCats, setOpenCats] = useState<CategoryId[]>([]);
  /**
   * The storyboard as it was before the last rewrite or redraw.
   *
   * Both of those buttons replace work that took thought, and one of them costs
   * money — a misclick should be one click to get back from, not a second rewrite
   * that produces something different again. It holds one step, which is the step
   * anyone actually wants.
   */
  const [storyUndo, setStoryUndo] = useState<{
    label: string;
    edits: Project['sceneEdits'];
    angle?: Project['scriptAngle'];
  } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planNote, setPlanNote] = useState('');
  const [planUndo, setPlanUndo] = useState<Project | null>(null);
  /** The brief this project was last read from, so it is not read twice for nothing. */
  const plannedFor = useRef('');
  useEffect(() => {
    if (scriptMissing) setStoryboardOpen(true);
  }, [scriptMissing]);

  /**
   * Read the brief and fill the project in: the use cases, their fields, the vehicle,
   * the presenter, the video settings. It only fills what is still blank — an answer
   * already given is never overwritten — and Undo puts everything back.
   */
  const fillFromBrief = async (force: boolean) => {
    const prompt = project?.prompt?.trim();
    if (!project || !prompt || planning) return;
    plannedFor.current = prompt;
    setPlanning(true);
    setPlanNote('');
    const r = await genApi.plan(prompt, project.clientId);
    setPlanning(false);
    if (isApiError(r)) {
      setPlanNote(`${r.code}: ${r.message}`);
      return;
    }
    const patch = applyBriefPlan(project, r, { cars, actors, force });
    if (!Object.keys(patch).length) {
      setPlanNote(r.why ? `${r.why} Everything it suggested is already set.` : 'Everything it suggested is already set.');
      return;
    }
    setPlanUndo(project);
    set(patch);
    const filled = [
      patch.useCases ? `the use case${patch.useCases.length > 1 ? 's' : ''}` : '',
      patch.fieldValues ? 'their fields' : '',
      patch.carIds ? 'the vehicle' : '',
      patch.actorId ? 'the presenter' : '',
      patch.spec ? 'the video settings' : '',
    ].filter(Boolean);
    setPlanNote(`${r.why ?? 'Read your brief.'} Filled ${filled.join(', ')} — change anything that is not right.`);
  };

  /** Fill every spoken scene with a real line, then let the designer edit them. */
  const writeScript = async (): Promise<string> => {
    if (!brief || !project) return 'Fill in the brief first.';
    const edits = keyedEdits(project.sceneEdits);
    // The storyboard travels with the request: a locked line is not rewritten, and
    // the writer is shown it anyway so the lines around it are written to flow with it.
    const r = await genApi.script(brief, language?.id, project.id, edits);
    if (!isApiError(r)) setStoryUndo({ label: 'the script', edits, angle: project.scriptAngle });
    if (isApiError(r)) return `${r.code}: ${r.message}`;
    if (!r.lines.length) return 'Every line is locked — unlock the ones you want rewritten.';
    const next = { ...edits };
    let kept = 0;
    for (const { index, key, line } of r.lines) {
      const k = key ?? built?.scenePlan.scenes[index]?.beat.key ?? String(index);
      // Locked is locked, whatever came back.
      if (next[k]?.locked?.includes('dialogue')) {
        kept += 1;
        continue;
      }
      // One line, said as written. Any respelling an older script left behind goes.
      next[k] = { ...next[k], dialogue: line, phonetic: undefined };
    }
    // The angle is saved with the copy: it is what the lines are arguing, and
    // judging a line without it is judging half the work.
    set({ sceneEdits: next, scriptAngle: r.angle });
    const written = r.lines.length - kept;
    return [
      `Wrote ${written} line${written === 1 ? '' : 's'} with ${r.model} — angle, draft, then an edit pass.`,
      kept ? `${kept} locked line${kept === 1 ? ' was' : 's were'} left exactly as written.` : '',
      'Read them through and fix anything that sounds off.',
    ]
      .filter(Boolean)
      .join(' ');
  };

  /**
   * Draw a still for these scenes, from the same photographs the film is built on.
   *
   * Sent in one request so the reference set is read once rather than per scene,
   * and each frame is filed under its own scene as it lands — a scene the model
   * refused does not cost the ones it drew.
   */
  const drawScenes = async (keys: string[]): Promise<string> => {
    if (!brief || !project || !built) return 'Fill in the brief first.';
    const mode = narrationMode(project.spec.narration);
    const edits = keyedEdits(project.sceneEdits);
    const wanted = built.scenePlan.scenes
      .filter((sc) => sc.beat.key && keys.includes(sc.beat.key))
      .map((sc) => {
        const ov = edits[sc.beat.key!] ?? {};
        const baseShot = !mode.onCameraPerson && sc.beat.shotAlt ? sc.beat.shotAlt : sc.beat.shot;
        return {
          key: sc.beat.key!,
          shot: (ov.shot ?? baseShot ?? '').trim(),
          title: sc.beat.title,
          line: (ov.phonetic ?? ov.dialogue ?? sc.beat.dialogue ?? '').trim() || undefined,
          ref: ov.ref,
        };
      })
      .filter((sc) => sc.shot);
    if (!wanted.length) return 'Those scenes have no shot direction to draw from.';

    const r = await genApi.sceneImages(brief, wanted);
    if (isApiError(r)) return `${r.code}: ${r.message}`;
    setStoryUndo({
      label: `${wanted.length} scene image${wanted.length === 1 ? '' : 's'}`,
      edits,
      angle: project.scriptAngle,
    });
    const next = { ...edits };
    for (const row of r.scenes) {
      if (row.frame) next[row.key] = { ...next[row.key], frame: row.frame };
    }
    set({ sceneEdits: next });
    const failed = r.scenes.filter((row) => row.error);
    return [
      `Drew ${r.made} scene${r.made === 1 ? '' : 's'}.`,
      failed.length ? `${failed.length} did not come back — ${failed[0]!.error}` : '',
    ]
      .filter(Boolean)
      .join(' ');
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

  /**
   * The whole film in order, including the beats this length has no room for, so
   * a scene moved while the film is short keeps its place if it grows again.
   */
  const orderedKeys = (): string[] =>
    brief
      ? buildBeats(buildContext(brief))
          .map((b) => b.key)
          .filter((k): k is string => Boolean(k))
      : [];

  /** Move a scene one place. Timing and the split into parts follow on their own. */
  const moveScene = (key: string, by: -1 | 1) => {
    const keys = orderedKeys();
    const i = keys.indexOf(key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= keys.length) return;
    const next = [...keys];
    next[i] = keys[j]!;
    next[j] = key;
    set({ sceneOrder: next });
  };

  /** A scene of the designer's own, written into the film where they put it. */
  const addScene = (afterKey?: string) => {
    if (!project) return;
    const key = `own:${Date.now().toString(36)}`;
    const keys = orderedKeys();
    const at = afterKey ? keys.indexOf(afterKey) + 1 : keys.length;
    set({
      addedScenes: [
        ...(project.addedScenes ?? []),
        { key, title: 'Your scene', shot: 'Describe the shot — what is on screen, and how it is filmed.' },
      ],
      sceneOrder: [...keys.slice(0, at), key, ...keys.slice(at)],
    });
  };

  /**
   * Scenes held out of this cut, and the scene each one sits after.
   *
   * A skipped scene is out of the film, so the plan no longer holds it — but its
   * row has to stay where it was or there is nothing to switch back on. So the
   * running order is worked out a second time with the skipped scenes still in
   * it, and each one remembers the last surviving scene before it.
   */
  const skippedScenes = useMemo(() => {
    if (!brief || !project) return [];
    const edits = project.sceneEdits ?? {};
    const skipped = new Set(
      Object.entries(edits)
        .filter(([, e]) => e?.skipped && !e?.deleted)
        .map(([k]) => k),
    );
    if (!skipped.size) return [];
    const deleted = Object.entries(edits)
      .filter(([, e]) => e?.deleted)
      .map(([k]) => k);
    const inPlan = new Set(
      (built?.scenePlan.scenes ?? []).map((sc) => sc.beat.key).filter((k): k is string => Boolean(k)),
    );
    const out: { key: string; title: string; cat: string; afterKey?: string }[] = [];
    let prev: string | undefined;
    for (const b of buildBeats(buildContext({ ...brief, omitScenes: deleted }))) {
      if (!b.key) continue;
      if (skipped.has(b.key)) out.push({ key: b.key, title: b.title, cat: b.cat ?? '', afterKey: prev });
      else if (inPlan.has(b.key)) prev = b.key;
    }
    return out;
  }, [brief, project, built]);

  /**
   * A storyboard edit, written straight through.
   *
   * Editing used to lock the field it touched, on the reasoning that a line you
   * typed is one you meant. That stops making sense once a lock actually locks:
   * the field would go read-only under the cursor mid-sentence. A lock is now only
   * ever put on and taken off by hand — closed means read-only here and untouched
   * by a rewrite, open means neither.
   */
  const editScene = (key: string, patch: Record<string, unknown>): void => {
    if (!project) return;
    const edits = keyedEdits(project.sceneEdits);
    set({ sceneEdits: { ...edits, [key]: { ...edits[key], ...patch } } });
  };

  /** Lock or unlock one field on one scene. */
  const lockScene = (key: string, field: LockField, lock: boolean): void => {
    if (!project) return;
    const edits = keyedEdits(project.sceneEdits);
    const was = edits[key] ?? {};
    const locked = lock
      ? [...new Set([...(was.locked ?? []), field])]
      : (was.locked ?? []).filter((l) => l !== field);
    set({ sceneEdits: { ...edits, [key]: { ...was, locked: locked.length ? locked : undefined } } });
  };

  /** Every lock on, or every lock off. */
  const lockAll = (lock: boolean): void => {
    if (!project || !built) return;
    const edits = keyedEdits(project.sceneEdits);
    const next = { ...edits };
    for (const sc of built.scenePlan.scenes) {
      const key = sc.beat.key;
      if (!key) continue;
      const was = next[key];
      if (!lock) {
        if (was?.locked) next[key] = { ...was, locked: undefined };
        continue;
      }
      // Locking all locks what has actually been written, not empty boxes.
      const fields: LockField[] = [];
      if ((was?.phonetic ?? was?.dialogue ?? '').trim()) fields.push('dialogue');
      if ((was?.shot ?? '').trim()) fields.push('shot');
      if (was?.card !== undefined || was?.cardSub !== undefined) fields.push('card');
      if (fields.length) next[key] = { ...was, locked: fields };
    }
    set({ sceneEdits: next });
  };

  /** Hold a scene out of this cut, or put it back. Nothing written in it is lost. */
  const skipScene = (key: string, skip: boolean) => {
    if (!project) return;
    const next = { ...keyedEdits(project.sceneEdits) };
    const rest = { ...next[key] };
    if (skip) rest.skipped = true;
    else delete rest.skipped;
    if (Object.values(rest).some((v) => v !== undefined)) next[key] = rest;
    else delete next[key];
    set({ sceneEdits: next });
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

  const stage = projectStage(project);
  // The face this dealership's audience already knows. Offered, never forced.
  const usual = usualActorFor(projects, project.clientId);
  const usualActor = usual ? actors.find((a) => a.id === usual.actorId) : null;
  const fit = formatFit(brief?.durationSec ?? project.spec.durationSec, project.spec.aspect);
  const parts = built?.parts ?? [];
  const sells = client?.vehicleKind ?? 'car';
  // A dealer can sell several brands; every one of them can be filmed.
  const clientBrands = (client?.brands?.length ? client.brands : [client?.brand]).filter((b): b is string => Boolean(b?.trim()));
  const pickableVehicles = cars.filter(
    (c) => (c.kind ?? 'car') === sells && (!clientBrands.length || clientBrands.some((b) => brandMatches(c.brand, b))),
  );
  const otherVehicles = cars.filter((c) => !pickableVehicles.includes(c));

  const selectedCar = car;
  const variants = selectedCar?.variants ?? [];
  const colours = selectedCar?.colours ?? [];

  // A festival is the setting, not a topic, so it does not count towards crowding the ad.
  const topicCount = project.useCases.filter((id) => CATEGORIES.find((c) => c.id === id)?.layer !== 'theme').length;

  const toggleUseCase = (id: CategoryId) => {
    const on = project.useCases.includes(id);
    // Picking a use case opens what it needs answered; dropping it puts that away.
    setOpenCats((cur) => (on ? cur.filter((x) => x !== id) : [...cur, id]));
    set({ useCases: on ? project.useCases.filter((u) => u !== id) : [...project.useCases, id] });
  };

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
          {readOnly ? (
            <span className="view-chip">View only</span>
          ) : savedAt ? (
            `Saved ${new Date(savedAt).toLocaleTimeString()}`
          ) : (
            'Changes save automatically'
          )}
        </span>
        <Lock inline>
        <div className="stage-pick">
          <span>Stage</span>
          <div className="seg">
            {PROJECT_STAGES.map((st) => (
              <button
                key={st.id}
                type="button"
                title={st.hint}
                className={stage === st.id ? 'on' : ''}
                onClick={() => set({ stage: st.id as ProjectStage })}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>
        </Lock>
        {!readOnly && (
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
        )}
      </div>

      <div className="grid">
        <div className="left-col">
          <Lock>
          <Section
            num="01"
            tour="ed-project"
            title="Project"
            step="Name, brief and tags"
            need={!readOnly && revenueMissing(project) ? 'Revenue needed' : undefined}
            {...fold('project')}
          >
            <Field label="Project name">
              <input
                value={project.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Sterling Hyundai — Creta feature reel"
              />
            </Field>
            <div className="row2">
              <Field
                label="Pack"
                hint="A trial pack is a film made to win a dealer over, or to test with. It needs no revenue, and Analytics leaves it out unless all packs are shown."
              >
                <div className="seg">
                  {(['paid', 'trial'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={packOf(project) === k ? 'on' : ''}
                      onClick={() => set({ packType: k })}
                    >
                      {k === 'paid' ? 'Paid' : 'Trial pack'}
                    </button>
                  ))}
                </div>
              </Field>
              <Field
                label={packOf(project) === 'paid' ? 'Campaign revenue (₹) · required' : 'Campaign revenue (₹)'}
                hint="What the dealer pays for this campaign. Analytics sets it against what the videos cost to make, for the gross margin by dealer, city and state."
              >
                <input
                  key={`${project.id}:${revenueSync}`}
                  inputMode="numeric"
                  defaultValue={project.campaignRevenueInr ? project.campaignRevenueInr.toLocaleString('en-IN') : ''}
                  onChange={(e) => set({ campaignRevenueInr: parseRupees(e.target.value) ?? 0 })}
                  placeholder={packOf(project) === 'paid' ? 'e.g. 25,000' : 'Optional for a trial'}
                  aria-invalid={revenueMissing(project)}
                  className={revenueMissing(project) ? 'needs' : undefined}
                />
              </Field>
            </div>
            <Field
              label="Your brief / prompt"
              hint="A free-text steer. What is still blank below is filled in from it."
            >
              <textarea
                value={project.prompt ?? ''}
                onChange={(e) => set({ prompt: e.target.value })}
                // Written once, read once: whatever is still blank is filled in from it.
                onBlur={() => {
                  const p = (project.prompt ?? '').trim();
                  if (p && p !== plannedFor.current) void fillFromBrief(false);
                }}
                placeholder="e.g. Ganesh Chaturthi post inviting customers to buy a bike this festive season."
              />
              <div className="toolbar" style={{ marginTop: 6 }}>
                <button
                  className="btn ghost small"
                  type="button"
                  disabled={planning || !(project.prompt ?? '').trim()}
                  onClick={() => void fillFromBrief(true)}
                  title="Read the brief again and replace what is already filled in"
                >
                  {planning ? 'Reading the brief…' : 'Fill from brief'}
                </button>
                {planUndo && (
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => {
                      const before = planUndo;
                      setPlanUndo(null);
                      setPlanNote('Put back as it was.');
                      set({
                        useCases: before.useCases,
                        fieldValues: before.fieldValues,
                        spec: before.spec,
                        carId: before.carId,
                        carIds: before.carIds,
                        carColour: before.carColour,
                        actorId: before.actorId,
                      });
                    }}
                  >
                    Undo
                  </button>
                )}
              </div>
              {planNote && <div className="hint">{planNote}</div>}
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
              <Field
                label="Presenter"
                hint={
                  project.useActor === false
                    ? 'Nobody on camera: no presenter is written into any shot and no photograph of one is sent. The film is the vehicle and the showroom, with a voice over it.'
                    : usualActor && usual
                      ? `${usualActor.name} fronts ${usual.count} of ${usual.total} films for this client. Whoever is picked is written into the shots that can hold a person — never into a driving shot or a beauty pass.`
                      : 'Whoever is picked is written into the shots that can hold a person — never forced into a driving shot or a beauty pass.'
                }
              >
                {/* Two decisions, in the order they are made: whether anyone is on
                    camera at all, and then who. The second is meaningless without
                    the first, so it greys out rather than sitting there enabled. */}
                <div className="sb-bar-row">
                  <div className="seg">
                    <button
                      type="button"
                      className={project.useActor !== false ? 'on' : ''}
                      onClick={() => set({ useActor: true })}
                    >
                      On camera
                    </button>
                    <button
                      type="button"
                      className={project.useActor === false ? 'on' : ''}
                      onClick={() => set({ useActor: false })}
                    >
                      Nobody
                    </button>
                  </div>
                  <select
                    value={project.actorId ?? ''}
                    disabled={project.useActor === false}
                    onChange={(e) => set({ actorId: e.target.value || undefined })}
                  >
                    <option value="">— none —</option>
                    {actors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                {project.useActor !== false && usualActor && project.actorId !== usualActor.id && (
                  <button
                    className="btn ghost small"
                    type="button"
                    style={{ marginTop: 6 }}
                    onClick={() => set({ actorId: usualActor.id })}
                  >
                    Use {usualActor.name}
                  </button>
                )}
              </Field>
              <Field
                label="Vehicles"
                hint={
                  vehicleIds.length > 1
                    ? `${vehicleIds.length} models — the first is the hero and carries the variant and colour.`
                    : clientBrands.length
                      ? `${clientBrands.join(' + ')} ${client?.vehicleKind === 'bike' ? 'bikes & scooters' : 'cars'} in your library. Leave empty to feature the whole range.`
                      : 'Leave empty to feature the whole range.'
                }
              >
                <Dropdown
                  label={
                    vehicleIds.length === 0
                      ? '— whole range —'
                      : vehicles.map((v) => `${v.brand} ${v.model}`).join(', ') || `${vehicleIds.length} selected`
                  }
                >
                  <div className="vehlist">
                    {pickableVehicles.length === 0 && (
                      <div className="hint">
                        Nothing in the library for {clientBrands.join(' or ') || 'this client'} yet — sync the brand in
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
                </Dropdown>
              </Field>
            </div>
            {selectedCar && (
              <div className="row2">
                <Field
                  label="Variant"
                  hint="Only for the facts the script may quote — the price, the fuel, the gearbox. The photographs the film is built on always come from the model's own library, whichever variant is picked."
                >
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
          </Section>

          <Section
            num="02"
            tour="ed-usecase"
            title="Use case"
            step={promptOnly ? 'Prompt-only — no video generation' : 'Composable — pick 1 or more'}
            {...fold('usecase')}
          >
            {project.useCases.length > 1 && brief && (
              <Banner kind="ok">
                Written as one ad — {storyGuidance(brief).useCase}: one opening, one close, and the points in between
                told as a single story{storyTheme(brief) ? ', with the festival as the look of every shot' : ''}.
              </Banner>
            )}
            {topicCount >= 3 && (
              <Banner kind="warn">
                {topicCount} topics in one ad. They share one opening and one close, but every extra topic takes
                seconds from the others — two usually lands best.
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

            {/* What a use case needs answered, right under where it was picked. Closed
                until it is wanted, and opened by picking the use case itself. */}
            <div className="sec-stack">
              {project.useCases.map((id) => {
                const cat = CATEGORIES.find((c) => c.id === id)!;
                const values = categoryValues(id, project.fieldValues[id] ?? {});
                const mandatory = new Set(cat.mandatory.map((m) => m.id));
                const missing = cat.mandatory.filter((m) =>
                  m.list ? !listRows(values, m.list).some((r) => r.text) : !String(values[m.id] ?? '').trim(),
                ).length;
                return (
                  <Section
                    key={id}
                    sub
                    title={cat.label}
                    need={missing ? `${missing} to fill in` : undefined}
                    step={missing ? undefined : 'Ready'}
                    open={openCats.includes(id)}
                    onOpenChange={(o) => setOpenCats((cur) => (o ? [...cur, id] : cur.filter((x) => x !== id)))}
                  >
                    <div className="section-desc">{cat.purpose}</div>
                    <div className="field-grid">
                      {cat.fields.map((f) => {
                        if (f.showIf && !values[f.showIf]) return null;
                        const label = `${f.label}${
                          mandatory.has(f.id) || cat.mandatory.some((m) => m.list === f.id) ? ' *' : ''
                        }`;
                        if (f.type === 'list' && f.list) {
                          return (
                            <div className="span" key={f.id}>
                              <ListField
                                field={f}
                                label={label}
                                values={values}
                                onPatch={(patch) => setFields(id, patch)}
                              />
                            </div>
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
                        if (f.type === 'textarea') {
                          return (
                            <div className="span" key={f.id}>
                              <Field label={label}>
                                <textarea
                                  value={values[f.id] ?? ''}
                                  placeholder={f.ph}
                                  onChange={(e) => setField(id, f.id, e.target.value)}
                                />
                              </Field>
                            </div>
                          );
                        }
                        return (
                          <Field key={f.id} label={label}>
                            {f.type === 'select' ? (
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
                  </Section>
                );
              })}
            </div>
          </Section>

          <Section num="03" tour="ed-video" title="Video" step="Length, shape, language, model" {...fold('video')}>
            <div className="field-grid">
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
                hint={language ? undefined : 'No languages configured — add one in Languages.'}
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
                    ? `${activeModel.minClipSec}–${activeModel.maxClipSec}s per clip${readOnly ? '' : ` · $${activeModel.usdPerSecond}/s`}${
                        usageLabel(activeModel.id) ? ` · ${usageLabel(activeModel.id)}` : ''
                      }. Counted by this app, so requests made elsewhere on the same key are not in it — but a model Google has said is used up shows as used up.`
                    : 'None registered — add one in APIs & models.'
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
                        {usageLabel(m.id) ? ` — ${usageLabel(m.id)}` : ''}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              {formatFitSummary(fit)}. {fit.notes.join(' ')}
            </div>

            {/* The rest of the video setup, folded until something needs changing. */}
            <div className="sec-stack">
              <Section sub title="Narration & audio" step={NARRATION[project.spec.narration].label}>
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
                  <Field label="Music / audio bed" hint="Scored after the film is cut, ducked under the voice.">
                    <input
                      value={project.spec.music}
                      onChange={(e) => setSpec({ music: e.target.value })}
                      placeholder="e.g. warm acoustic, light percussion"
                    />
                  </Field>
                </div>
                {/* How fast the voice speaks. It settles the instruction to the model
                    and the words each scene's seconds are worth at the same time, so
                    a faster read genuinely buys more to say rather than asking for
                    hurry. A walkaround and a three-day offer are not read alike. */}
                {narrationMode(project.spec.narration).speaks && (
                  <Field
                    label="Speaking pace"
                    hint={`${speechRate(project.spec.speechWpm).hint} — about ${
                      speechRate(project.spec.speechWpm).wpm
                    } words a minute. Every scene's word budget is worked out at this speed.`}
                  >
                    <div className="seg">
                      {SPEECH_RATES.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className={(project.spec.speechWpm ?? DEFAULT_WPM) === r.wpm ? 'on' : ''}
                          onClick={() => setSpec({ speechWpm: r.wpm })}
                          title={`${r.hint} — ${r.wpm} words a minute`}
                        >
                          {r.label}
                          <em>{r.wpm}</em>
                        </button>
                      ))}
                    </div>
                  </Field>
                )}
              </Section>

              <Section
                sub
                title="On-screen text & end card"
                step={project.spec.endCardOn ? 'Ends on a dealer card' : 'No end card'}
              >
                <div className="field-grid">
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
                      onChange={(e) => setSpec({ captionStyle: e.target.value as ProjectVideoSpec['captionStyle'] })}
                    >
                      <option value="Long Narrative">Long Narrative</option>
                      <option value="Short Punchy">Short Punchy</option>
                      <option value="Structured">Structured minimal</option>
                    </select>
                  </Field>
                  <Field label="Primary CTA">
                    <input value={project.spec.cta} onChange={(e) => setSpec({ cta: e.target.value })} />
                  </Field>
                  <Field label="Footer strip" hint="Set once per client, in Clients.">
                    <input readOnly value={client ? footerPreview : 'Select a client to set the footer'} />
                  </Field>
                </div>
                <Field
                  label="Look"
                  hint="The colours of the captions, the footer strip and the end card, drawn here as they will be on the film. Where each caption sits is set per scene in the storyboard."
                >
                  <LookPicker
                    value={project.spec.overlayThemeId}
                    custom={project.spec.overlayCustom}
                    onChange={(patch) => setSpec(patch)}
                    dealer={client?.displayName?.trim() || client?.name}
                    cta={project.spec.cta}
                    footer={client ? footerPreview : undefined}
                  />
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
              </Section>

              <Section sub title="Advanced" step="Look, resolution, clip length">
                <Field label="Visual style">
                  <input value={project.spec.visualStyle} onChange={(e) => setSpec({ visualStyle: e.target.value })} />
                </Field>
                <div className="row2">
                  <Field
                    label="Resolution"
                    hint={(() => {
                      if (!activeModel) return undefined;
                      const r = renderResolution(activeModel.modelId, project.spec.resolution, activeModel.resolutions);
                      return r.upscale
                        ? `${activeModel.name} renders ${r.render}; upscaled to ${project.spec.resolution} in post.`
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
                      <option value="360p">360p — cheap test render</option>
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
                          maxChunkSec: Math.min(Number(e.target.value), activeModel?.maxClipSec ?? Number(e.target.value)),
                        })
                      }
                    />
                  </Field>
                </div>
              </Section>
            </div>
          </Section>

          <Section
            num="04"
            tour="ed-refs"
            title="References"
            step="What the model is handed"
            note={`The vehicle, the presenter and the dealership come in on their own — there is nothing to pick. The list below is everything in scope, in the order ${
              activeModel?.name ?? 'the model'
            } is given it and numbered the way the prompt numbers it. Cross one out to leave it out of the next run: it stays on the list, struck through, until you put it back.`}
            {...fold('refs')}
          >
            {refPlan &&
              (() => {
                const heldBack = refPlan.spare.filter((e) => e.held);
                const overflow = refPlan.spare.filter((e) => !e.held);
                const images = refPlan.sent.filter((e) => e.role !== 'video');
                const videos = refPlan.sent.filter((e) => e.role === 'video');
                return (
                  <Section
                    sub
                    title="What the model is handed"
                    step={`${images.length} of ${refPlan.max} images${
                      videos.length ? ` · ${videos.length} of ${refPlan.maxVideos} videos` : ''
                    }${heldBack.length ? ` · ${heldBack.length} held back` : ''}`}
                  >
                    {refPlan.sent.length ? (
                      <div className="ref-plan">
                        {refPlan.sent.map((e) => (
                          <RefRow key={e.photo.filename} entry={e} onHold={holdRef} />
                        ))}
                      </div>
                    ) : (
                      <Banner kind="warn">
                        Nothing is being sent. Pick a vehicle and a client, or attach photos below — a film built on
                        no references is a film about whatever the model remembers.
                      </Banner>
                    )}

                    {overflow.length > 0 && (
                      <>
                        <div className="ref-group">Past the limit — not sent</div>
                        <div className="hint">
                          {activeModel?.name ?? 'This model'} takes {refPlan.max} images. Cross something out above
                          to make room for these.
                        </div>
                        <div className="ref-plan">
                          {overflow.map((e) => (
                            <RefRow key={e.photo.filename} entry={e} onHold={holdRef} />
                          ))}
                        </div>
                      </>
                    )}

                    {heldBack.length > 0 && (
                      <>
                        <div className="ref-group">Held back by you</div>
                        <div className="ref-plan">
                          {heldBack.map((e) => (
                            <RefRow key={e.photo.filename} entry={e} onHold={holdRef} />
                          ))}
                        </div>
                      </>
                    )}

                    {refPlan.overlays.length > 0 && (
                      <>
                        <div className="ref-group">Composited in post — never sent to the model</div>
                        <div className="ref-plan">
                          {refPlan.overlays.map((e) => (
                            <RefRow key={e.photo.filename} entry={e} />
                          ))}
                        </div>
                      </>
                    )}
                  </Section>
                );
              })()}

            <Section
              sub
              title="The vehicle"
              step={
                (project.carRefs?.length ?? 0) > 0
                  ? `${project.carRefs!.length} attached — the library is ignored`
                  : car
                    ? `${project.useSheets === false ? 'Photographs' : 'Sheets'} from ${car.brand} ${car.model}`
                    : 'No vehicle picked'
              }
            >
              {/* The wrong car is this app's oldest bug, and it is nearly always the
                  wrong record rather than the wrong prompt. Both handles are here,
                  beside the list that shows what the record actually sends. */}
              <div className="row2">
                <Field label="Pulled from" hint="Which library record the photographs come from.">
                  <select
                    value={vehicleIds[0] ?? ''}
                    onChange={(e) => {
                      const id = e.target.value;
                      const rest = vehicleIds.filter((x) => x !== id).slice(0, 3);
                      set({
                        carIds: id ? [id, ...rest] : rest,
                        carId: id || rest[0],
                        // Variant and colour belong to the hero, so they stop
                        // meaning anything the moment it changes.
                        carVariant: undefined,
                        carColour: undefined,
                      });
                    }}
                  >
                    <option value="">— no specific model —</option>
                    {cars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.brand} {c.model}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Called, in this film"
                  hint="Only the words change — the photographs are still the ones listed above."
                >
                  <input
                    value={project.carModelOverride ?? ''}
                    placeholder={brief?.carModel || 'Mahindra XUV 3XO'}
                    onChange={(e) => set({ carModelOverride: e.target.value || undefined })}
                  />
                </Field>
              </div>

              {car?.sheets && Object.keys(car.sheets).length > 0 && (
                <div className="check-row">
                  <input
                    type="checkbox"
                    id="pe_sheets"
                    checked={project.useSheets !== false}
                    onChange={(e) => set({ useSheets: e.target.checked })}
                  />
                  <label htmlFor="pe_sheets">
                    Send the vehicle&rsquo;s reference sheets —{' '}
                    <span className="hint" style={{ display: 'inline', marginTop: 0 }}>
                      every photograph of one side in a single image, so four slots carry the whole car instead of
                      four angles of it. Turn this off to send the loose photographs instead. The captioned features
                      sheet is never sent either way.
                    </span>
                  </label>
                </div>
              )}

              {/* Photos attached here ARE the vehicle: the library is not consulted at all.
                  Which side each one shows travels with it, so a scene about the cabin is
                  built on the cabin photo — and a side nobody attached is a side the model
                  has to invent, which is how an XUV300 ended up in a film about the 3XO. */}
              <Field
                label="Photos of this exact vehicle"
                hint="Attach the car or bike this film shows — several at once. The library is then ignored completely and every shot is built on these."
              >
                <div className="thumbs">
                  {(project.carRefs ?? []).map((r) => (
                    <div className="veh-photo" key={r.refId}>
                      <Thumb
                        img={r}
                        onRemove={() => set({ carRefs: (project.carRefs ?? []).filter((x) => x.refId !== r.refId) })}
                      />
                      <select
                        aria-label={`What ${r.label} shows`}
                        value={r.angle ?? ''}
                        onChange={(e) =>
                          set({
                            carRefs: (project.carRefs ?? []).map((x) =>
                              x.refId === r.refId
                                ? { ...x, angle: (e.target.value || undefined) as CarAngle | undefined }
                                : x,
                            ),
                          })
                        }
                      >
                        <option value="">Which side?</option>
                        <option value="front">Front</option>
                        <option value="side">Side</option>
                        <option value="rear">Rear</option>
                        <option value="interior">Interior</option>
                      </select>
                    </div>
                  ))}
                  <ImageUpload
                    label={`${[car?.brand, car?.model].filter(Boolean).join(' ') || project.name || 'Vehicle'} — exact photo`}
                    kind="car-model"
                    buttonText="Attach vehicle photos"
                    multiple
                    onUploaded={(img) => set({ carRefs: [...(project.carRefs ?? []), img] })}
                  />
                </div>
                {(project.carRefs?.length ?? 0) > 0 &&
                  (() => {
                    const have = new Set((project.carRefs ?? []).map((r) => r.angle).filter(Boolean));
                    const missing = (['front', 'side', 'rear', 'interior'] as CarAngle[]).filter((a) => !have.has(a));
                    return (
                      <Banner kind={missing.length > 1 ? 'warn' : 'ok'}>
                        {project.carRefs!.length} attached photo{project.carRefs!.length === 1 ? '' : 's'} —{' '}
                        {[car?.brand, car?.model].filter(Boolean).join(' ') || 'this vehicle'} is built from{' '}
                        {project.carRefs!.length === 1 ? 'this' : 'these'} alone, and the library is ignored.
                        {missing.length
                          ? ` Nothing shows the ${missing.join(', ')} — the model invents those, and for a model name it has
                              seen on an older car, what it invents is that older car. Attach them.`
                          : ' All four sides are covered.'}
                      </Banner>
                    );
                  })()}
              </Field>
            </Section>

            <Section
              sub
              title="Add more"
              step={`${project.extraRefs.length} image${project.extraRefs.length === 1 ? '' : 's'} · ${
                project.videoRefs?.length ?? 0
              } video${(project.videoRefs?.length ?? 0) === 1 ? '' : 's'}`}
            >
              <Field
                label="Extra images"
                hint="Anything this film needs that the client and vehicle records do not already carry."
              >
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
              </Field>

              {/* A model that takes video references learns motion and light from them
                  in a way no still can teach it. Omni takes three. */}
              <Field
                label="Reference videos"
                hint="Up to three — the real showroom, the real vehicle moving. Sent to the models that accept video; ignored by those that do not."
              >
                <div className="thumbs">
                  {(project.videoRefs ?? []).map((v) => (
                    <div className="veh-photo" key={v.refId}>
                      <div className="thumb">
                        {v.url ? (
                          <video src={v.url} muted playsInline preload="metadata" />
                        ) : (
                          <div className="thumb-ph">▶</div>
                        )}
                        <span title={v.label}>{v.label}</span>
                        <button
                          className="thumb-x"
                          type="button"
                          aria-label={`Remove ${v.label}`}
                          onClick={() =>
                            set({ videoRefs: (project.videoRefs ?? []).filter((x) => x.refId !== v.refId) })
                          }
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                  {(project.videoRefs?.length ?? 0) < 3 && (
                    <ImageUpload
                      label={`${project.name || 'Project'} — reference video`}
                      kind="reference-video"
                      accept="video/*"
                      buttonText="Add reference video"
                      onUploaded={(v) => set({ videoRefs: [...(project.videoRefs ?? []), v] })}
                    />
                  )}
                </div>
                {(project.videoRefs?.length ?? 0) >= 3 && (
                  <div className="hint">Three is the most any model here takes.</div>
                )}
              </Field>
            </Section>
          </Section>

          {built?.scenePlan && built.scenePlan.scenes.length > 0 && (
            <Section
              num="05"
              tour="ed-storyboard"
              title="Storyboard"
              open={storyboardOpen}
              onOpenChange={setStoryboardOpen}
              need={scriptMissing ? 'Needs a script' : undefined}
              step={`${built.scenePlan.scenes.length} scenes · ${built.scenePlan.parts} segment${
                built.scenePlan.parts > 1 ? 's' : ''
              }`}
            >
              <Storyboard
                scenePlan={built.scenePlan}
                sceneEdits={project.sceneEdits}
                narration={project.spec.narration}
                onEditScene={editScene}
                onClearEdits={() => set({ sceneEdits: {} })}
                attachments={brief?.attachments ?? []}
                angle={project.scriptAngle}
                onWriteScript={writeScript}
                languageName={language?.name}
                onDrawScenes={drawScenes}
                onLockScene={lockScene}
                onLockAll={lockAll}
                undoLabel={storyUndo?.label}
                onUndo={
                  storyUndo
                    ? () => {
                        set({ sceneEdits: storyUndo.edits, scriptAngle: storyUndo.angle });
                        setStoryUndo(null);
                      }
                    : undefined
                }
                vehicle={brief?.vehicleKind ?? 'car'}
                speechWpm={project.spec.speechWpm}
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
                skippedScenes={skippedScenes}
                onSkipScene={skipScene}
                onMoveScene={moveScene}
                onAddScene={addScene}
              />
            </Section>
          )}
          </Lock>
        </div>

        <div className="right-col">
          {!project.clientId && <Banner kind="warn">No client selected — footer and end card will be empty.</Banner>}
          {preflight && !readOnly && (
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
              <Lock>
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
              </Lock>
            </Panel>
          )}

          {brief && !promptOnly && parts.length > 0 && preflight && (
            <GenerationPanel
              brief={brief}
              parts={parts}
              scenePlan={built?.scenePlan ?? null}
              canGenerate={preflight.canGenerate}
              revenueNeeded={revenueMissing(project)}
              needsCostConfirm={!!cost?.needsConfirmation}
              costInr={cost?.inr ?? 0}
              modelId={project.spec.modelId ?? activeModel?.id}
              modelLabel={activeModel?.name}
              project={{ id: project.id, name: project.name }}
              sceneOverrides={project.sceneEdits}
              resolution={project.spec.resolution}
              onRestore={(snapshot, when) => {
                const was = snapshot as Partial<Project>;
                const stamp = new Date(when).toLocaleString();
                if (!window.confirm(`Put this project back to how it was for the ${stamp} run? Every video you have already made is kept.`)) return;
                set({
                  prompt: was.prompt ?? '',
                  useCases: was.useCases ?? [],
                  spec: was.spec ?? project.spec,
                  fieldValues: was.fieldValues ?? {},
                  sceneEdits: was.sceneEdits ?? {},
                  clientId: was.clientId,
                  actorId: was.actorId,
                  carId: was.carId,
                  carIds: was.carIds,
                  carVariant: was.carVariant,
                  carColour: was.carColour,
                  carRefs: was.carRefs ?? [],
                  extraRefs: was.extraRefs ?? [],
                  scriptAngle: was.scriptAngle,
                });
              }}
              onGenerated={(jobId, finalUrl) =>
                set({
                  status: 'generated',
                  // A film that has been made is no longer waiting to be started.
                  stage: stage === 'open' ? 'wip' : stage,
                  lastJobId: jobId,
                  lastFinalUrl: finalUrl ?? undefined,
                })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
