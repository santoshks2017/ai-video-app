import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  EDIT_AUDIO_TRACK,
  EDIT_BRAND_LOGO_TRACK,
  EDIT_CAPTION_TRACK,
  EDIT_DEALER_LOGO_TRACK,
  EDIT_FILTERS,
  EDIT_FOOTER_TRACK,
  EDIT_FONTS,
  EDIT_MAIN_TRACK,
  EDIT_STILL_SECONDS,
  EDIT_TEXT_PRESETS,
  EDIT_TEXT_TRACK,
  EDIT_TRANSITIONS,
  addEditClip,
  duplicateEditClip,
  editClipAt,
  editClipKind,
  editProjectFromLayers,
  editClipEnd,
  editClipLength,
  editFilterMatrices,
  editProjectLength,
  editSnap,
  editSnapPoints,
  editTimecode,
  moveEditClip,
  newEditProject,
  packEditTrack,
  removeEditClip,
  splitEditClip,
  trimEditClip,
  updateEditClip,
  type Brief,
  type EditAspect,
  type EditClip,
  type EditPlacement,
  type EditProject,
  type EditSource,
} from '@ava/shared';
import { api, isApiError, type EditOpen, type GenerationHistoryItem } from '../lib/api.js';
import { abs, uploadRef } from '../lib/client.js';
import { filesFrom, PASTE_KEYS } from './ui.js';
import { LayerPanel } from './editor/LayerPanel.js';
import { LayerStage } from './editor/LayerStage.js';
import { useLayerImages } from './editor/useLayerImages.js';

/**
 * The video editor.
 *
 * A timeline editor in the shape the design team already knows from Lumina: the
 * material on the left, the player on the right, the timeline underneath. Films
 * from this project, the vehicle and dealership photographs from its library, and
 * anything uploaded here can be laid out, cut, re-timed, graded, joined with
 * transitions and titled — and the export is rendered on the server with ffmpeg,
 * so it costs nothing and cannot change what a shot shows.
 *
 * The preview is the browser's approximation: it plays the clip under the playhead
 * with its grade and fades, cross-fades during a transition whatever kind it is, and
 * draws the text over the top. The export renders exactly what is on the timeline.
 * Work in progress is kept as a draft on this device, per film.
 */

interface Material {
  key: string;
  source: EditSource;
  thumb?: string;
}

type Panel = 'material' | 'text' | 'transitions' | 'filters' | 'clip';

const LANE_PAD = 14;
const ROW_H: Record<string, number> = {
  [EDIT_CAPTION_TRACK]: 36,
  [EDIT_DEALER_LOGO_TRACK]: 30,
  [EDIT_BRAND_LOGO_TRACK]: 30,
  [EDIT_FOOTER_TRACK]: 30,
  [EDIT_TEXT_TRACK]: 36,
  [EDIT_MAIN_TRACK]: 66,
  [EDIT_AUDIO_TRACK]: 42,
};
const rowH = (id: string): number => ROW_H[id] ?? 36;
const TRACK_LABEL: Record<string, string> = {
  [EDIT_CAPTION_TRACK]: 'Captions',
  [EDIT_DEALER_LOGO_TRACK]: 'Dealer logo',
  [EDIT_BRAND_LOGO_TRACK]: 'Brand logo',
  [EDIT_FOOTER_TRACK]: 'Footer',
  [EDIT_TEXT_TRACK]: 'Text',
  [EDIT_MAIN_TRACK]: 'Main',
  [EDIT_AUDIO_TRACK]: 'Sound',
};
/** What a clip is called on its bar and in its panel. */
const clipLabel = (c: EditClip): string =>
  c.layer?.kind === 'caption'
    ? c.layer.text
    : c.layer?.kind === 'footer'
      ? c.layer.text || 'Footer'
      : c.layer?.kind === 'logo'
        ? c.layer.which === 'dealer'
          ? 'Dealer logo'
          : 'Brand logo'
        : c.layer?.kind === 'endcard'
          ? 'End card'
          : (c.text ?? c.source?.label ?? '');
const asAspect = (a?: string): EditAspect => (a === '9:16' || a === '1:1' ? a : '16:9');
const mmss = (s: number): string =>
  `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function mediaDuration(url: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const el: HTMLMediaElement = document.createElement(kind === 'video' ? 'video' : 'audio');
    let settled = false;
    const done = (d: number): void => {
      if (settled) return;
      settled = true;
      resolve(Number.isFinite(d) ? d : 0);
      el.removeAttribute('src');
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(0);
    el.src = url;
  });
}

const runSource = (r: GenerationHistoryItem, duration: number): EditSource => ({
  type: 'video',
  label: r.label ?? `Film · ${new Date(r.createdAt).toLocaleDateString()}`,
  url: r.finalUrl ?? '',
  duration,
  jobId: r.jobId,
  poster: r.posterUrl ?? undefined,
});

/** How opaque a clip is at a moment, from its fades. */
function fadeOpacity(c: EditClip, t: number): number {
  const local = t - c.start;
  const len = editClipLength(c);
  let o = 1;
  if (c.fadeIn > 0) o = Math.min(o, local / c.fadeIn);
  if (c.fadeOut > 0) o = Math.min(o, (len - local) / c.fadeOut);
  return clamp(o, 0, 1);
}

/** Keep a media element on the moment of its clip; seek only when it has drifted. */
function syncMedia(
  el: HTMLMediaElement | null,
  clip: EditClip | undefined,
  t: number,
  play: boolean,
  muted: boolean,
): void {
  if (!el) return;
  const src = clip?.source && clip.source.type !== 'image' ? clip.source.url : '';
  if (!clip || !src) {
    if (!el.paused) el.pause();
    return;
  }
  if (el.getAttribute('data-src') !== src) {
    el.setAttribute('data-src', src);
    el.src = src;
  }
  const want = clip.in + (t - clip.start) * clip.speed;
  el.playbackRate = clamp(clip.speed, 0.25, 4);
  el.muted = muted || clip.volume <= 0;
  el.volume = clamp(clip.volume, 0, 1);
  if (play) {
    if (Math.abs(el.currentTime - want) > 0.35) el.currentTime = want;
    if (el.paused) void el.play().catch(() => {});
  } else {
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - want) > 0.04) el.currentTime = want;
  }
}

const Icon = ({ d, title }: { d: string; title?: string }) => (
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden focusable="false">
    {title ? <title>{title}</title> : null}
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ICONS = {
  material: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  text: 'M5 6h14M12 6v13M9 19h6',
  transitions: 'M4 7h9l-3-3M20 17h-9l3 3M4 17l5-10M15 7l5 10',
  filters: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM8 11a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM16 11a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  clip: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  split: 'M9 4v16M15 4v16M6 8l3 4-3 4M18 8l-3 4 3 4',
  del: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  dup: 'M8 8h11v11H8zM5 16V5h11',
  magnet: 'M6 4v7a6 6 0 0 0 12 0V4M6 8h4M14 8h4',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  axis: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  zoomOut: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM8 11h6M16 16l4 4',
  zoomIn: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM8 11h6M11 8v6M16 16l4 4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.2A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.1 6.1C3.6 7.8 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.3-1',
  sound: 'M4 10v4h4l5 4V6l-5 4zM16 9a4 4 0 0 1 0 6',
  soundOff: 'M4 10v4h4l5 4V6l-5 4zM17 9l5 6M22 9l-5 6',
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14M16 5v14',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  plus: 'M12 5v14M5 12h14',
};

export function VideoEditor({
  run,
  others,
  brief,
  sceneOverrides,
  onClose,
  onExported,
  demo = false,
}: {
  run: GenerationHistoryItem;
  /** Other finished films in this project, to lay out alongside it. */
  others: GenerationHistoryItem[];
  /** The brief, for the vehicle and dealership photographs in its library. */
  brief?: Brief;
  /** The storyboard's edits, for rebuilding the layers of a film made before layers were kept. */
  sceneOverrides?: Record<string, unknown>;
  onClose: () => void;
  onExported: (jobId: string) => void;
  /** A viewer trying the editor: every tool works, and nothing is uploaded or exported. */
  demo?: boolean;
}) {
  const draftKey = `ava.edit.v1.${run.jobId}`;
  const [ready, setReady] = useState(false);
  const [project, setProject] = useState<EditProject>(() => newEditProject(asAspect(run.aspect)));
  const projectRef = useRef(project);
  const past = useRef<EditProject[]>([]);
  const future = useRef<EditProject[]>([]);
  const [, setHistoryTick] = useState(0);
  const [uploads, setUploads] = useState<Material[]>([]);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayheadState] = useState(0);
  const playheadRef = useRef(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(60);
  const [magnet, setMagnet] = useState(true);
  const [linkage, setLinkage] = useState(true);
  const [previewAxis, setPreviewAxis] = useState(false);
  const [panel, setPanel] = useState<Panel>('material');
  const [materialTab, setMaterialTab] = useState<'all' | 'video' | 'image' | 'audio'>('all');
  const [materialSource, setMaterialSource] = useState<'project' | 'library'>('project');
  const [transitionTab, setTransitionTab] = useState<'all' | 'Foundation' | 'Erase'>('all');
  const [filterTab, setFilterTab] = useState<'all' | 'Daily' | 'Stylize'>('all');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState('');
  const [exporting, setExporting] = useState<null | { label: string; busy: boolean; error: string }>(null);
  const [preparing, setPreparing] = useState(false);
  /** A draft made on the finished picture, waiting on the choice to keep it or start with layers. */
  const [draftChoice, setDraftChoice] = useState<null | { draft: { project: EditProject; uploads: Material[] }; layered: EditProject }>(null);
  const begin = useCallback((p: EditProject, kept: Material[] = []) => {
    projectRef.current = p;
    setProject(p);
    setUploads(kept);
    setReady(true);
  }, []);

  const setPlayhead = useCallback((t: number) => {
    const v = Math.max(0, t);
    playheadRef.current = v;
    setPlayheadState(v);
  }, []);

  /* ---- history: every change is a new project, and the old one is kept ---- */

  const live = useCallback((next: EditProject) => {
    projectRef.current = next;
    setProject(next);
  }, []);
  const commit = useCallback((next: EditProject, before: EditProject = projectRef.current) => {
    if (next === before) return;
    past.current.push(before);
    if (past.current.length > 150) past.current.shift();
    future.current = [];
    projectRef.current = next;
    setProject(next);
    setHistoryTick((n) => n + 1);
  }, []);
  /** A slider drag is one step of history, not sixty. */
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const edit = useCallback(
    (key: string, next: EditProject) => {
      const now = Date.now();
      if (lastEdit.current && lastEdit.current.key === key && now - lastEdit.current.at < 800) live(next);
      else commit(next);
      lastEdit.current = { key, at: now };
    },
    [commit, live],
  );
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(projectRef.current);
    live(prev);
    setHistoryTick((n) => n + 1);
  }, [live]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(projectRef.current);
    live(next);
    setHistoryTick((n) => n + 1);
  }, [live]);

  /** A film's layers as an edit: its clean footage, its end card, and every overlay where the film drew it. */
  const layeredProject = async (o: Extract<EditOpen, { mode: 'layers' }>): Promise<EditProject> => {
    const total = o.layers.bodySeconds + (o.layers.endCard?.seconds ?? 0);
    const cleanSeconds = (await mediaDuration(o.cleanUrl, 'video')) || o.layers.bodySeconds;
    const musicSeconds = o.musicUrl ? (await mediaDuration(o.musicUrl, 'audio')) || total : 0;
    setDurations((cur) => ({ ...cur, [`run:${run.jobId}`]: cleanSeconds }));
    return editProjectFromLayers({
      aspect: asAspect(run.aspect),
      layers: o.layers,
      clean: { type: 'video', label: `${run.label ?? 'Film'} · footage`, url: o.cleanUrl, duration: cleanSeconds, jobId: run.jobId, variant: 'clean', poster: run.posterUrl ?? undefined },
      ...(o.musicUrl && o.layers.music
        ? { music: { type: 'audio' as const, label: 'Music', url: o.musicUrl, duration: Math.max(musicSeconds, total), storagePath: o.layers.music.storagePath } }
        : {}),
    });
  };

  /* ---- open: the draft, or the film laid on the main track ---- */

  useEffect(() => {
    let alive = true;
    void (async () => {
      let draft: { project: EditProject; uploads: Material[] } | null = null;
      try {
        const raw = localStorage.getItem(draftKey);
        const d = raw ? (JSON.parse(raw) as { project?: EditProject; uploads?: Material[] }) : null;
        if (d?.project && (d.project.version === 1 || d.project.version === 2)) draft = { project: d.project, uploads: d.uploads ?? [] };
      } catch {
        /* a draft that cannot be read is started over */
      }
      // A draft that already holds the film's layers carries on where it was left.
      if (draft?.project.look) return begin(draft.project, draft.uploads);

      setPreparing(true);
      const opened = await api.editOpen(run.jobId, { brief, sceneOverrides });
      if (!alive) return;
      setPreparing(false);
      if (!isApiError(opened)) {
        const layered = opened.mode === 'edit' ? opened.editProject : await layeredProject(opened);
        if (!alive) return;
        if (opened.mode === 'layers' && opened.note) setNotice(opened.note);
        if (draft) return setDraftChoice({ draft, layered });
        return begin(layered);
      }
      // Captions and logos stay part of the picture: the film opens as it always did.
      setNotice(opened.message);
      if (draft) return begin(draft.project, draft.uploads);
      const d = run.finalUrl ? (await mediaDuration(run.finalUrl, 'video')) || run.totalSeconds || 0 : 0;
      if (!alive) return;
      const start = newEditProject(asAspect(run.aspect));
      const first =
        run.finalUrl && d > 0
          ? addEditClip(
              start,
              { trackId: EDIT_MAIN_TRACK, start: 0, in: 0, out: d, source: runSource(run, d), speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 },
              { magnet: true },
            ).project
          : start;
      setDurations((cur) => ({ ...cur, [`run:${run.jobId}`]: d }));
      begin(first);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ project, uploads }));
      } catch {
        /* storage full or unavailable — the edit still exports */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [project, uploads, ready, draftKey]);

  /* ---- material ---- */

  const projectMaterials = useMemo<Material[]>(
    () => [
      ...[run, ...others]
        .filter((r) => r.finalUrl)
        .map((r) => ({
          key: `run:${r.jobId}`,
          source: runSource(r, durations[`run:${r.jobId}`] ?? r.totalSeconds ?? 0),
          thumb: r.posterUrl ?? undefined,
        })),
      ...uploads,
    ],
    [run, others, uploads, durations],
  );
  const libraryMaterials = useMemo<Material[]>(
    () =>
      (brief?.attachments ?? [])
        .filter((a) => a.src && a.kind !== 'reference-video' && a.kind !== 'logo' && a.kind !== 'brand-logo')
        .map((a) => {
          const url = abs(a.src ?? null) ?? a.src ?? '';
          return { key: `lib:${a.filename}`, source: { type: 'image', label: a.label, url, storagePath: a.storagePath }, thumb: url };
        }),
    [brief],
  );
  const allMaterials = useMemo(() => [...projectMaterials, ...libraryMaterials], [projectMaterials, libraryMaterials]);

  const ensureDuration = async (m: Material): Promise<number> => {
    const src = m.source;
    if (src.type === 'image') return EDIT_STILL_SECONDS;
    const known = durations[m.key];
    if (known) return known;
    const d = (await mediaDuration(src.url, src.type)) || src.duration;
    setDurations((cur) => ({ ...cur, [m.key]: d }));
    return d;
  };

  const mainInsertTime = (): number => {
    const under = editClipAt(projectRef.current, EDIT_MAIN_TRACK, playheadRef.current);
    return under ? editClipEnd(under) - 0.001 : playheadRef.current;
  };

  const addMaterial = async (m: Material, at?: number): Promise<void> => {
    const d = await ensureDuration(m);
    if (d <= 0) {
      setNotice(`Could not read the length of "${m.source.label}".`);
      return;
    }
    const src = m.source;
    const trackId = src.type === 'audio' ? EDIT_AUDIO_TRACK : EDIT_MAIN_TRACK;
    const source: EditSource = src.type === 'image' ? src : { ...src, duration: d };
    const t = at ?? (trackId === EDIT_MAIN_TRACK && magnet ? mainInsertTime() : playheadRef.current);
    const r = addEditClip(
      projectRef.current,
      { trackId, start: Math.max(0, t), in: 0, out: d, source, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 },
      { magnet },
    );
    commit(r.project);
    setSelectedId(r.id);
    setNotice('');
  };

  const addText = (preset: (typeof EDIT_TEXT_PRESETS)[number], at?: number): void => {
    const r = addEditClip(
      projectRef.current,
      {
        trackId: EDIT_TEXT_TRACK,
        start: Math.max(0, at ?? playheadRef.current),
        in: 0,
        out: EDIT_STILL_SECONDS,
        text: preset.text,
        style: { ...preset.style },
        speed: 1,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
      },
      { magnet: false },
    );
    commit(r.project);
    setSelectedId(r.id);
    setPanel('clip');
  };

  const onFiles = async (files: FileList | File[] | null): Promise<void> => {
    if (demo) {
      setNotice('Uploading material is not available for viewer access.');
      return;
    }
    const list = [...(files ?? [])];
    for (const [i, f] of list.entries()) {
      setUploading(list.length > 1 ? `Uploading ${i + 1} of ${list.length}…` : 'Uploading…');
      const type: 'video' | 'image' | 'audio' = f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'image';
      const r = await uploadRef(f, f.name, `editor-${type}`);
      if (isApiError(r)) {
        setNotice(r.message);
        break;
      }
      const d = type === 'image' ? 0 : await mediaDuration(r.url, type);
      const source: EditSource =
        type === 'image'
          ? { type, label: f.name, url: r.url, storagePath: r.storagePath }
          : { type, label: f.name, url: r.url, storagePath: r.storagePath, duration: d };
      const key = `up:${r.refId}`;
      setUploads((u) => [...u, { key, source, thumb: type === 'image' ? r.url : undefined }]);
      if (d) setDurations((x) => ({ ...x, [key]: d }));
    }
    setUploading('');
  };

  /* ---- editing the selection ---- */

  const selected = project.clips.find((c) => c.id === selectedId) ?? null;
  const settle = (p: EditProject, c: EditClip): EditProject =>
    magnet && c.trackId === EDIT_MAIN_TRACK ? packEditTrack(p, EDIT_MAIN_TRACK) : p;
  const mainList = useMemo(
    () => project.clips.filter((c) => c.trackId === EDIT_MAIN_TRACK).sort((a, b) => a.start - b.start),
    [project],
  );

  const splitNow = (): void => {
    const t = playheadRef.current;
    const p = projectRef.current;
    const target =
      selected && t > selected.start && t < editClipEnd(selected) ? selected : editClipAt(p, EDIT_MAIN_TRACK, t);
    if (!target) {
      setNotice('Move the playhead over a clip to split it.');
      return;
    }
    const r = splitEditClip(p, target.id, t);
    if (r.project === p) {
      setNotice('Too close to the edge of the clip to split there.');
      return;
    }
    commit(r.project);
    if (r.id) setSelectedId(r.id);
    setNotice('');
  };
  const deleteNow = (): void => {
    if (!selected) return;
    commit(removeEditClip(projectRef.current, selected.id, { magnet }));
    setSelectedId(null);
    if (panel === 'clip') setPanel('material');
  };
  const duplicateNow = (): void => {
    if (!selected) return;
    const r = duplicateEditClip(projectRef.current, selected.id, { magnet });
    commit(r.project);
    if (r.id) setSelectedId(r.id);
  };

  /**
   * Where a filter lands: the selected main-track clip, or with none selected, every
   * clip on the main track — the whole film. It used to need a selection and say so
   * only in the header, so a click in the panel looked like it did nothing.
   */
  const filterTargets = (p: EditProject): EditClip[] =>
    selected && selected.trackId === EDIT_MAIN_TRACK
      ? p.clips.filter((c) => c.id === selected.id)
      : p.clips.filter((c) => c.trackId === EDIT_MAIN_TRACK);
  const applyFilter = (id: string | null): void => {
    const p = projectRef.current;
    const targets = filterTargets(p);
    if (!targets.length) {
      setNotice('Add a video or a still to the main track, then pick a filter.');
      return;
    }
    commit(
      targets.reduce(
        (next, c) => updateEditClip(next, c.id, { filter: id ? { id, strength: c.filter?.strength ?? 1 } : undefined }),
        p,
      ),
    );
    setNotice('');
  };
  const setFilterStrength = (strength: number): void => {
    const p = projectRef.current;
    edit(
      'filter-strength',
      filterTargets(p).reduce(
        (next, c) => (c.filter ? updateEditClip(next, c.id, { filter: { id: c.filter.id, strength } }) : next),
        p,
      ),
    );
  };
  const applyTransition = (id: string | null): void => {
    const isFirst = mainList[0]?.id === selected?.id;
    if (!selected || selected.trackId !== EDIT_MAIN_TRACK || isFirst) {
      setNotice('Select the clip the transition leads into — any clip on the main track after the first.');
      return;
    }
    const next = updateEditClip(projectRef.current, selected.id, {
      transition: id ? { id, duration: selected.transition?.duration ?? 0.6 } : undefined,
    });
    commit(settle(next, selected));
    setNotice('');
  };

  /* ---- playback ---- */

  const length = editProjectLength(project);
  const togglePlay = useCallback(() => {
    setHoverTime(null);
    setPlaying((was) => {
      if (was) return false;
      if (playheadRef.current >= editProjectLength(projectRef.current) - 0.05) setPlayhead(0);
      return true;
    });
  }, [setPlayhead]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      const len = editProjectLength(projectRef.current);
      const next = playheadRef.current + dt;
      if (next >= len) {
        setPlayhead(len);
        setPlaying(false);
        return;
      }
      setPlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, setPlayhead]);

  const viewTime = hoverTime ?? playhead;
  const trackOf = (id: string) => project.tracks.find((t) => t.id === id);
  const mainClip = trackOf(EDIT_MAIN_TRACK)?.hidden ? undefined : editClipAt(project, EDIT_MAIN_TRACK, viewTime);
  const mainIndex = mainClip ? mainList.findIndex((c) => c.id === mainClip.id) : -1;
  const prevClip = mainIndex > 0 ? mainList[mainIndex - 1] : undefined;
  const inTransition = Boolean(
    mainClip?.transition && prevClip && viewTime < mainClip.start + mainClip.transition.duration,
  );
  const transitionProgress =
    inTransition && mainClip?.transition ? clamp((viewTime - mainClip.start) / mainClip.transition.duration, 0, 1) : 1;

  const mainVideo = useRef<HTMLVideoElement>(null);
  const underVideo = useRef<HTMLVideoElement>(null);
  const soundRefs = useRef(new Map<string, HTMLAudioElement>());
  const sounds = project.clips.filter((c) => c.trackId === EDIT_AUDIO_TRACK && c.source?.type === 'audio');
  const shouldPlay = playing && hoverTime === null;

  useEffect(() => {
    const mainMuted = Boolean(trackOf(EDIT_MAIN_TRACK)?.muted);
    syncMedia(mainVideo.current, mainClip?.source?.type === 'video' ? mainClip : undefined, viewTime, shouldPlay, mainMuted);
    syncMedia(
      underVideo.current,
      inTransition && prevClip?.source?.type === 'video' ? prevClip : undefined,
      viewTime,
      shouldPlay,
      true,
    );
    const audioTrack = trackOf(EDIT_AUDIO_TRACK);
    for (const c of sounds) {
      const active = viewTime >= c.start && viewTime < editClipEnd(c) && !audioTrack?.hidden;
      syncMedia(soundRefs.current.get(c.id) ?? null, active ? c : undefined, viewTime, shouldPlay, Boolean(audioTrack?.muted));
    }
  });

  /* ---- player geometry ---- */

  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);
  const ar = project.aspect === '9:16' ? 9 / 16 : project.aspect === '1:1' ? 1 : 16 / 9;
  const stageW = Math.max(0, Math.min(box.w, box.h * ar));
  const stageH = stageW / ar;

  const lookDef = (c: EditClip | undefined) => (c?.filter ? EDIT_FILTERS.find((f) => f.id === c.filter!.id) : undefined);
  const lookId = (c: EditClip): string => `ve-look-${c.id.replace(/[^\w-]/g, '_')}`;
  const lookOf = (c: EditClip | undefined): string => (c && lookDef(c) ? `url(#${lookId(c)})` : 'none');
  // The filter the panel shows as picked: null when none of its clips has one, undefined when they differ.
  const filterScope = filterTargets(project);
  const filterOn =
    filterScope.length && filterScope.every((c) => c.filter?.id === filterScope[0]!.filter?.id)
      ? (filterScope[0]!.filter ?? null)
      : undefined;
  const texts = trackOf(EDIT_TEXT_TRACK)?.hidden
    ? []
    : project.clips.filter(
        (c) => c.trackId === EDIT_TEXT_TRACK && c.text && c.style && viewTime >= c.start && viewTime < editClipEnd(c),
      );
  const layerImages = useLayerImages(project.clips, project.look);
  const placeLayer = (id: string, place: EditPlacement): void => live(updateEditClip(projectRef.current, id, { place }));
  const commitLayer = (before: EditProject): void => commit(projectRef.current, before);
  const nudgeLayer = (id: string, place: EditPlacement): void => edit(`nudge:${id}`, updateEditClip(projectRef.current, id, { place }));

  /* ---- timeline ---- */

  const scrollRef = useRef<HTMLDivElement>(null);
  const timeAt = (clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const b = el.getBoundingClientRect();
    return Math.max(0, (clientX - b.left + el.scrollLeft - LANE_PAD) / pps);
  };
  const span = Math.max(length, 10) + 10;
  const step = pps >= 120 ? 1 : pps >= 50 ? 2 : pps >= 24 ? 5 : pps >= 10 ? 10 : 30;
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);
  const laneWidth = LANE_PAD * 2 + span * pps;

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = LANE_PAD + playhead * pps;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
  }, [playhead, playing, pps]);

  const drag = useRef<null | { kind: 'move' | 'in' | 'out'; id: string; origin: EditProject; grab: number; moved: boolean }>(null);
  const scrubbing = useRef(false);

  /** Move a clip; with linkage on, the text and sound laid over a main-track clip travel with it. */
  const moveWithLinks = (origin: EditProject, id: string, start: number, final: boolean): EditProject => {
    const c = origin.clips.find((x) => x.id === id);
    if (!c) return origin;
    let next = moveEditClip(origin, id, start, { magnet: false });
    if (final && magnet && c.trackId === EDIT_MAIN_TRACK) next = packEditTrack(next, EDIT_MAIN_TRACK);
    if (linkage && c.trackId === EDIT_MAIN_TRACK) {
      const delta = (next.clips.find((x) => x.id === id)?.start ?? c.start) - c.start;
      const end = editClipEnd(c);
      if (Math.abs(delta) > 0.001) {
        next = {
          ...next,
          clips: next.clips.map((x) =>
            x.trackId !== EDIT_MAIN_TRACK && x.start >= c.start - 0.001 && x.start < end - 0.001
              ? { ...x, start: Math.max(0, x.start + delta) }
              : x,
          ),
        };
      }
    }
    return next;
  };

  const beginDrag = (e: ReactPointerEvent<HTMLElement>, kind: 'move' | 'in' | 'out', clip: EditClip): void => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedId(clip.id);
    setPanel('clip');
    setPlaying(false);
    drag.current = { kind, id: clip.id, origin: projectRef.current, grab: timeAt(e.clientX) - clip.start, moved: false };
  };
  const dragMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d) return;
    const c = d.origin.clips.find((x) => x.id === d.id);
    if (!c) return;
    const t = timeAt(e.clientX);
    const points = e.altKey ? [] : editSnapPoints(d.origin, d.id, playheadRef.current);
    const reach = 8 / pps;
    d.moved = true;
    if (d.kind === 'move') {
      const raw = t - d.grab;
      const len = editClipLength(c);
      const byStart = editSnap(raw, points, reach);
      const byEnd = editSnap(raw + len, points, reach) - len;
      const start = Math.abs(byStart - raw) <= Math.abs(byEnd - raw) ? byStart : byEnd;
      live(moveWithLinks(d.origin, d.id, start, false));
    } else {
      live(trimEditClip(d.origin, d.id, d.kind, editSnap(t, points, reach), { magnet: false }));
    }
  };
  const endDrag = (): void => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    const current = projectRef.current;
    let final = current;
    if (d.kind === 'move') {
      const c = current.clips.find((x) => x.id === d.id);
      if (c) final = moveWithLinks(d.origin, d.id, c.start, true);
    } else {
      const c = current.clips.find((x) => x.id === d.id);
      if (c) final = settle(current, c);
    }
    commit(final, d.origin);
  };

  const scrubStart = (e: ReactPointerEvent<HTMLElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = true;
    setPlaying(false);
    setHoverTime(null);
    setPlayhead(timeAt(e.clientX));
  };
  const scrubMove = (e: ReactPointerEvent<HTMLElement>): void => {
    if (scrubbing.current) setPlayhead(timeAt(e.clientX));
  };
  const scrubEnd = (): void => {
    scrubbing.current = false;
  };

  const onLaneDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const t = timeAt(e.clientX);
    const textId = e.dataTransfer.getData('text/ava-text');
    if (textId) {
      const preset = EDIT_TEXT_PRESETS.find((x) => x.id === textId);
      if (preset) addText(preset, t);
      return;
    }
    const m = allMaterials.find((x) => x.key === e.dataTransfer.getData('text/ava-material'));
    if (m) void addMaterial(m, t);
  };

  /* ---- keyboard ---- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      // Arrow keys belong to a selected layer while the preview has focus.
      if (e.key.startsWith('Arrow') && t?.closest?.('.ve-layers')) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (exporting && !exporting.busy) setExporting(null);
        else if (!exporting) onClose();
        return;
      }
      if (exporting) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicateNow();
      } else if (!mod && key === 's') {
        e.preventDefault();
        splitNow();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteNow();
      } else if (e.key === 'ArrowLeft') {
        setPlayhead(playheadRef.current - (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === 'ArrowRight') {
        setPlayhead(playheadRef.current + (e.shiftKey ? 1 : 1 / 30));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---- export ---- */

  const doExport = async (): Promise<void> => {
    if (!exporting || demo) return;
    setExporting({ ...exporting, busy: true, error: '' });
    const r = await api.renderEdit(projectRef.current, exporting.label);
    if (isApiError(r)) {
      setExporting((x) => (x ? { ...x, busy: false, error: r.message } : x));
      return;
    }
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* nothing to clear */
    }
    onExported(r.jobId);
  };

  const toggleTrack = (id: string, field: 'muted' | 'hidden'): void => {
    commit({
      ...projectRef.current,
      tracks: projectRef.current.tracks.map((t) => (t.id === id ? { ...t, [field]: !t[field] } : t)),
    });
  };

  /* ---- render ---- */

  const tabs = (value: string, options: [string, string][], set: (v: string) => void): ReactNode => (
    <div className="ve-tabs" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => set(v)}>
          {label}
        </button>
      ))}
    </div>
  );

  const shownMaterials = (materialSource === 'project' ? projectMaterials : libraryMaterials).filter(
    (m) => materialTab === 'all' || m.source.type === materialTab,
  );
  const inUse = (m: Material): boolean => project.clips.some((c) => c.source?.url === m.source.url);

  const clipPanel = (c: EditClip): ReactNode => {
    if (c.layer && projectRef.current.look) {
      return (
        <LayerPanel
          clip={c}
          project={projectRef.current}
          look={projectRef.current.look}
          images={layerImages}
          readOnly={demo}
          onPatch={(key, patch) => edit(`${key}:${c.id}`, updateEditClip(projectRef.current, c.id, patch))}
          onProject={(key, next) => edit(`${key}:${c.id}`, next)}
          onDelete={deleteNow}
          onNotice={setNotice}
        />
      );
    }
    const len = editClipLength(c);
    const kind = editClipKind(c);
    const upd = (key: string, patch: Partial<EditClip>, resettle = false): void => {
      const next = updateEditClip(projectRef.current, c.id, patch);
      edit(`${key}:${c.id}`, resettle ? settle(next, c) : next);
    };
    const style = c.style;
    return (
      <div className="ve-props">
        <div className="ve-props-head">
          <b>{kind === 'text' ? 'Text' : kind === 'image' ? 'Still' : kind === 'audio' ? 'Sound' : 'Video'}</b>
          <span>
            {clipLabel(c)} · {len.toFixed(1)}s
          </span>
        </div>

        {kind === 'text' && style && (
          <>
            <label className="ve-field">
              <span>Text</span>
              <textarea rows={2} value={c.text ?? ''} onChange={(e) => upd('text', { text: e.target.value })} />
            </label>
            <div className="ve-row">
              <label className="ve-field">
                <span>Font</span>
                <select value={style.font} onChange={(e) => upd('font', { style: { ...style, font: e.target.value } })}>
                  {EDIT_FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ve-field narrow">
                <span>Colour</span>
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(style.color) ? style.color : '#ffffff'} onChange={(e) => upd('color', { style: { ...style, color: e.target.value } })} />
              </label>
            </div>
            <label className="ve-field">
              <span>Size · {Math.round(style.size * 100)}</span>
              <input type="range" min={0.02} max={0.2} step={0.005} value={style.size} onChange={(e) => upd('size', { style: { ...style, size: Number(e.target.value) } })} />
            </label>
            <div className="ve-row">
              <label className="ve-check">
                <input type="checkbox" checked={style.bold} onChange={(e) => upd('bold', { style: { ...style, bold: e.target.checked } })} />
                Bold
              </label>
              <label className="ve-check">
                <input
                  type="checkbox"
                  checked={Boolean(style.background)}
                  onChange={(e) => upd('bg', { style: { ...style, background: e.target.checked ? 'rgba(0,0,0,0.6)' : null } })}
                />
                Panel behind
              </label>
            </div>
            <div className="ve-tabs small">
              {(['left', 'center', 'right'] as const).map((a) => (
                <button key={a} type="button" className={style.align === a ? 'on' : ''} onClick={() => upd('align', { style: { ...style, align: a } })}>
                  {a === 'center' ? 'Centre' : a[0]!.toUpperCase() + a.slice(1)}
                </button>
              ))}
            </div>
            <label className="ve-field">
              <span>Across · {Math.round(style.x * 100)}%</span>
              <input type="range" min={0} max={1} step={0.01} value={style.x} onChange={(e) => upd('x', { style: { ...style, x: Number(e.target.value) } })} />
            </label>
            <label className="ve-field">
              <span>Down · {Math.round(style.y * 100)}%</span>
              <input type="range" min={0} max={1} step={0.01} value={style.y} onChange={(e) => upd('y', { style: { ...style, y: Number(e.target.value) } })} />
            </label>
          </>
        )}

        {kind === 'video' && (
          <label className="ve-field">
            <span>Speed · {c.speed.toFixed(2)}×</span>
            <input type="range" min={0.25} max={4} step={0.05} value={c.speed} onChange={(e) => upd('speed', { speed: Number(e.target.value) }, true)} />
          </label>
        )}
        {(kind === 'video' || kind === 'audio') && (
          <label className="ve-field">
            <span>
              Volume · {Math.round(c.volume * 100)}%{c.volume > 1 ? ' (the preview tops out at 100%)' : ''}
            </span>
            <input type="range" min={0} max={2} step={0.05} value={c.volume} onChange={(e) => upd('volume', { volume: Number(e.target.value) })} />
          </label>
        )}
        <div className="ve-row">
          <label className="ve-field">
            <span>Fade in · {c.fadeIn.toFixed(1)}s</span>
            <input type="range" min={0} max={Math.max(0.1, Math.min(3, len / 2))} step={0.1} value={c.fadeIn} onChange={(e) => upd('fadeIn', { fadeIn: Number(e.target.value) })} />
          </label>
          <label className="ve-field">
            <span>Fade out · {c.fadeOut.toFixed(1)}s</span>
            <input type="range" min={0} max={Math.max(0.1, Math.min(3, len / 2))} step={0.1} value={c.fadeOut} onChange={(e) => upd('fadeOut', { fadeOut: Number(e.target.value) })} />
          </label>
        </div>

        {c.trackId === EDIT_MAIN_TRACK && (
          <>
            <label className="ve-field">
              <span>Filter</span>
              <select value={c.filter?.id ?? ''} onChange={(e) => applyFilter(e.target.value || null)}>
                <option value="">None</option>
                {EDIT_FILTERS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.group} · {f.name}
                  </option>
                ))}
              </select>
            </label>
            {c.filter && (
              <label className="ve-field">
                <span>Strength · {Math.round(c.filter.strength * 100)}%</span>
                <input type="range" min={0} max={1} step={0.05} value={c.filter.strength} onChange={(e) => upd('strength', { filter: { id: c.filter!.id, strength: Number(e.target.value) } })} />
              </label>
            )}
            {mainList[0]?.id !== c.id && (
              <>
                <label className="ve-field">
                  <span>Transition into this clip</span>
                  <select value={c.transition?.id ?? ''} onChange={(e) => applyTransition(e.target.value || null)}>
                    <option value="">None — a cut</option>
                    {EDIT_TRANSITIONS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.group} · {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                {c.transition && (
                  <label className="ve-field">
                    <span>Transition length · {c.transition.duration.toFixed(1)}s</span>
                    <input type="range" min={0.2} max={2} step={0.1} value={c.transition.duration} onChange={(e) => upd('tlen', { transition: { id: c.transition!.id, duration: Number(e.target.value) } }, true)} />
                  </label>
                )}
              </>
            )}
          </>
        )}

        <div className="ve-row">
          <button type="button" className="ve-btn" onClick={duplicateNow}>
            Duplicate
          </button>
          <button type="button" className="ve-btn danger" onClick={deleteNow}>
            Delete
          </button>
        </div>
      </div>
    );
  };

  const trackRows = project.tracks.map((tr) => tr.id);

  return createPortal(
    <div className="ve-wrap" role="dialog" aria-label="Video editor">
      {/* The looks as colour matrices, so the preview grades exactly as the export will. */}
      <svg className="ve-defs" aria-hidden="true">
        {EDIT_FILTERS.map((f) => (
          <filter key={f.id} id={`ve-swatch-${f.id}`} colorInterpolationFilters="sRGB">
            {editFilterMatrices(f, 1).map((values, i) => (
              <feColorMatrix key={i} type="matrix" values={values} />
            ))}
          </filter>
        ))}
        {[prevClip, mainClip].map((c) => {
          const def = lookDef(c);
          return c && def ? (
            <filter key={c.id} id={lookId(c)} colorInterpolationFilters="sRGB">
              {editFilterMatrices(def, c.filter!.strength).map((values, i) => (
                <feColorMatrix key={i} type="matrix" values={values} />
              ))}
            </filter>
          ) : null;
        })}
      </svg>
      <header className="ve-head">
        <div>
          <h2>Video Editor</h2>
          <span>{demo ? 'Try every tool — nothing done here changes the film' : `${run.label ?? 'this film'} · a draft is kept on this device`}</span>
        </div>
        <div className="ve-head-actions">
          {notice && <span className="ve-notice">{notice}</span>}
          <button type="button" className="ve-btn ghost" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="ve-btn primary"
            disabled={!ready || !mainList.length}
            onClick={() => setExporting({ label: `${run.label ?? 'Edited cut'} · edited`, busy: false, error: '' })}
          >
            Export
          </button>
        </div>
      </header>

      <div className="ve-top">
        <aside className="ve-side">
          <nav className="ve-rail" aria-label="Editor tools">
            {(
              [
                ['material', 'Material'],
                ['text', 'Text'],
                ['transitions', 'Transitions'],
                ['filters', 'Filters'],
                ...(selected ? [['clip', 'Edit clip'] as [Panel, string]] : []),
              ] as [Panel, string][]
            ).map(([id, label]) => (
              <button key={id} type="button" title={label} aria-label={label} className={panel === id ? 'on' : ''} onClick={() => setPanel(id)}>
                <Icon d={ICONS[id]} />
              </button>
            ))}
          </nav>

          <div className="ve-panel">
            {panel === 'material' && (
              <>
                <div className="ve-panel-head">
                  <h3>Material</h3>
                  <div className="ve-panel-actions">
                    <button
                      type="button"
                      className={`ve-chip${materialSource === 'library' ? ' on' : ''}`}
                      onClick={() => setMaterialSource(materialSource === 'library' ? 'project' : 'library')}
                      title="The vehicle and dealership photographs this film was built on"
                    >
                      material library
                    </button>
                    <span
                      className="ve-chip ve-paste"
                      tabIndex={0}
                      role="button"
                      title={`Click here, then paste an image, a video or a sound (${PASTE_KEYS})`}
                      onPaste={(e) => {
                        const files = filesFrom(e.clipboardData, 'video/*,image/*,audio/*');
                        if (!files.length) return;
                        e.preventDefault();
                        void onFiles(files);
                      }}
                    >
                      Paste
                    </span>
                    <label className="ve-chip accent">
                      {uploading || '+ Upload material'}
                      <input type="file" hidden multiple accept="video/*,image/*,audio/*" onChange={(e) => void onFiles(e.target.files).then(() => { e.target.value = ''; })} />
                    </label>
                  </div>
                </div>
                {tabs(materialTab, [['all', 'All'], ['video', 'Video'], ['image', 'Image'], ['audio', 'Audio']], (v) => setMaterialTab(v as typeof materialTab))}
                <div className="ve-grid">
                  {shownMaterials.map((m) => (
                    <div
                      key={m.key}
                      className="ve-mat"
                      draggable
                      title={`${m.source.label} — drag onto the timeline, or press +`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/ava-material', m.key);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                    >
                      <div className="ve-mat-thumb" style={m.thumb ? { backgroundImage: `url("${m.thumb}")` } : undefined}>
                        {m.source.type === 'audio' && <span className="ve-mat-icon">♪</span>}
                        {m.source.type !== 'image' && (durations[m.key] ?? (m.source.type === 'video' ? m.source.duration : 0)) > 0 && (
                          <span className="ve-mat-dur">{mmss(durations[m.key] ?? (m.source.type === 'video' ? m.source.duration : 0))}</span>
                        )}
                        {inUse(m) && <span className="ve-mat-added">Added</span>}
                        <button type="button" className="ve-mat-add" aria-label={`Add ${m.source.label} to the timeline`} onClick={() => void addMaterial(m)}>
                          <Icon d={ICONS.plus} />
                        </button>
                      </div>
                      <span className="ve-mat-name">{m.source.label}</span>
                    </div>
                  ))}
                  {!shownMaterials.length && (
                    <div className="ve-empty">
                      {materialSource === 'library'
                        ? 'No library photographs on this brief.'
                        : materialTab === 'audio'
                          ? 'Upload music or a voice track to use it here.'
                          : 'Nothing here yet — upload material.'}
                    </div>
                  )}
                </div>
              </>
            )}

            {panel === 'text' && (
              <>
                <div className="ve-panel-head">
                  <h3>Text</h3>
                </div>
                <div className="ve-list">
                  {EDIT_TEXT_PRESETS.map((t) => {
                    const font = EDIT_FONTS.find((f) => f.id === t.style.font);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className="ve-text-preset"
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/ava-text', t.id)}
                        onClick={() => addText(t)}
                        title="Add at the playhead, or drag onto the timeline"
                      >
                        <b style={{ fontFamily: font?.css, fontWeight: t.style.bold ? 700 : 400 }}>{t.name}</b>
                        <span>{font?.name}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="ve-hint">
                  Text is drawn over the film when it exports, in the fonts the render server has — so it looks the
                  same in the export as here.
                </div>
              </>
            )}

            {panel === 'transitions' && (
              <>
                <div className="ve-panel-head">
                  <h3>Transition</h3>
                </div>
                {tabs(transitionTab, [['all', 'All'], ['Foundation', 'Foundation'], ['Erase', 'Erase']], (v) => setTransitionTab(v as typeof transitionTab))}
                <div className="ve-grid two">
                  {EDIT_TRANSITIONS.filter((t) => transitionTab === 'all' || t.group === transitionTab).map((t) => (
                    <button key={t.id} type="button" className={`ve-effect${selected?.transition?.id === t.id ? ' on' : ''}`} onClick={() => applyTransition(t.id)}>
                      <span className={`ve-trans-swatch ${t.id}`} />
                      <span>{t.name}</span>
                    </button>
                  ))}
                </div>
                <div className="ve-hint">
                  Select a clip on the main track, then pick one: it plays into that clip from the one before. The
                  preview shows every transition as a cross-fade; the export renders the one you picked.
                </div>
              </>
            )}

            {panel === 'filters' && (
              <>
                <div className="ve-panel-head">
                  <h3>Filter</h3>
                </div>
                <div className="ve-scope">
                  {selected?.trackId === EDIT_MAIN_TRACK ? (
                    <>
                      <span>Applies to the selected clip</span>
                      <button type="button" className="ve-scope-btn" onClick={() => setSelectedId(null)}>
                        Use on the whole film
                      </button>
                    </>
                  ) : (
                    <span>Applies to the whole film</span>
                  )}
                </div>
                {tabs(filterTab, [['all', 'All'], ['Daily', 'Daily'], ['Stylize', 'Stylize']], (v) => setFilterTab(v as typeof filterTab))}
                <div className="ve-grid two">
                  <button type="button" className={`ve-effect${filterOn === null ? ' on' : ''}`} onClick={() => applyFilter(null)}>
                    <span className="ve-filter-swatch" style={{ backgroundImage: run.posterUrl ? `url("${run.posterUrl}")` : undefined }} />
                    <span>None</span>
                  </button>
                  {EDIT_FILTERS.filter((f) => filterTab === 'all' || f.group === filterTab).map((f) => (
                    <button key={f.id} type="button" className={`ve-effect${filterOn?.id === f.id ? ' on' : ''}`} onClick={() => applyFilter(f.id)}>
                      <span
                        className="ve-filter-swatch"
                        style={{
                          backgroundImage: run.posterUrl ? `url("${run.posterUrl}")` : undefined,
                          filter: `url(#ve-swatch-${f.id})`,
                        }}
                      />
                      <span>{f.name}</span>
                    </button>
                  ))}
                </div>
                {filterOn && (
                  <label className="ve-field ve-filter-strength">
                    <span>Strength · {Math.round(filterOn.strength * 100)}%</span>
                    <input type="range" min={0} max={1} step={0.05} value={filterOn.strength} onChange={(e) => setFilterStrength(Number(e.target.value))} />
                  </label>
                )}
              </>
            )}

            {panel === 'clip' &&
              (selected ? clipPanel(selected) : <div className="ve-empty">Select a clip on the timeline to edit it.</div>)}
          </div>
        </aside>

        <section className="ve-player">
          <div className="ve-panel-head">
            <h3>Player</h3>
          </div>
          <div className="ve-player-box" ref={boxRef}>
            {!ready ? (
              <div className="ve-empty">{preparing ? "Preparing this film's layers — the first time only, about as long as a restitch." : 'Loading the film…'}</div>
            ) : (
              <div className="ve-stage" style={{ width: stageW, height: stageH }}>
                {inTransition && prevClip && (
                  <>
                    <video ref={underVideo} className="ve-layer" playsInline muted style={{ filter: lookOf(prevClip), display: prevClip.source?.type === 'video' ? undefined : 'none' }} />
                    {prevClip.source?.type === 'image' && <img className="ve-layer" src={prevClip.source.url} alt="" style={{ filter: lookOf(prevClip) }} />}
                  </>
                )}
                <video
                  ref={mainVideo}
                  className="ve-layer"
                  playsInline
                  style={{
                    filter: lookOf(mainClip),
                    opacity: mainClip ? fadeOpacity(mainClip, viewTime) * transitionProgress : 0,
                    display: mainClip?.source?.type === 'video' ? undefined : 'none',
                  }}
                />
                {mainClip?.source?.type === 'image' && (
                  <img
                    className="ve-layer"
                    src={mainClip.source.url}
                    alt=""
                    style={{ filter: lookOf(mainClip), opacity: fadeOpacity(mainClip, viewTime) * transitionProgress }}
                  />
                )}
                {mainClip?.layer?.kind === 'endcard' && layerImages.get(mainClip.id) && (
                  <img className="ve-layer" src={layerImages.get(mainClip.id)!.url} alt="" style={{ opacity: fadeOpacity(mainClip, viewTime) * transitionProgress }} />
                )}
                {project.look && (
                  <LayerStage
                    project={project}
                    look={project.look}
                    viewTime={viewTime}
                    stageW={stageW}
                    stageH={stageH}
                    selectedId={selectedId}
                    images={layerImages}
                    fadeOpacity={fadeOpacity}
                    readOnly={demo}
                    onSelect={(id) => {
                      setSelectedId(id);
                      setPanel('clip');
                    }}
                    onMove={placeLayer}
                    onCommit={commitLayer}
                    onNudge={nudgeLayer}
                    onEditText={(id) => {
                      setSelectedId(id);
                      setPanel('clip');
                      setTimeout(() => document.querySelector<HTMLTextAreaElement>('.ve-props textarea')?.focus(), 0);
                    }}
                  />
                )}
                {texts.map((t) => {
                  const s = t.style!;
                  const size = Math.min(stageW, stageH) * s.size;
                  const css: CSSProperties = {
                    left: `${s.x * 100}%`,
                    top: `${s.y * 100}%`,
                    fontFamily: EDIT_FONTS.find((f) => f.id === s.font)?.css,
                    fontSize: size,
                    fontWeight: s.bold ? 700 : 400,
                    color: s.color,
                    textAlign: s.align,
                    background: s.background ?? undefined,
                    padding: s.background ? `${size * 0.2}px ${size * 0.35}px` : undefined,
                    opacity: fadeOpacity(t, viewTime),
                    outline: t.id === selectedId ? '1px dashed rgba(255,255,255,0.7)' : undefined,
                  };
                  return (
                    <div key={t.id} className="ve-text" style={css} onPointerDown={() => { setSelectedId(t.id); setPanel('clip'); }}>
                      {t.text}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="ve-transport">
            <span className="ve-timecode">
              <b>{editTimecode(viewTime)}</b> / {editTimecode(length)}
            </span>
            <button type="button" className="ve-play" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
              <Icon d={playing ? ICONS.pause : ICONS.play} />
            </button>
            <div className="ve-transport-right">
              <select className="ve-aspect" value={project.aspect} aria-label="Aspect ratio" onChange={(e) => commit({ ...projectRef.current, aspect: e.target.value as EditAspect })}>
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
              </select>
              <button type="button" className="ve-icon" aria-label="Full screen view" title="Full screen" onClick={() => void boxRef.current?.requestFullscreen?.()}>
                <Icon d={ICONS.full} />
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="ve-timeline">
        <div className="ve-toolbar">
          <div className="ve-tools">
            <button type="button" className="ve-icon" title="Undo (⌘Z)" aria-label="Undo" disabled={!past.current.length} onClick={undo}>
              <Icon d={ICONS.undo} />
            </button>
            <button type="button" className="ve-icon" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!future.current.length} onClick={redo}>
              <Icon d={ICONS.redo} />
            </button>
            <span className="ve-sep" />
            <button type="button" className="ve-icon" title="Split at the playhead (S)" aria-label="Split" onClick={splitNow}>
              <Icon d={ICONS.split} />
            </button>
            <button type="button" className="ve-icon" title="Delete (⌫)" aria-label="Delete" disabled={!selected} onClick={deleteNow}>
              <Icon d={ICONS.del} />
            </button>
            <button type="button" className="ve-icon" title="Duplicate (⌘D)" aria-label="Duplicate" disabled={!selected} onClick={duplicateNow}>
              <Icon d={ICONS.dup} />
            </button>
          </div>
          <div className="ve-tools">
            <button type="button" className={`ve-icon${magnet ? ' on' : ''}`} aria-pressed={magnet} title={`Main track magnet ${magnet ? 'on' : 'off'} — close the gaps on the main track`} aria-label="Main track magnet" onClick={() => setMagnet((m) => !m)}>
              <Icon d={ICONS.magnet} />
            </button>
            <button type="button" className={`ve-icon${linkage ? ' on' : ''}`} aria-pressed={linkage} title={`Linkage ${linkage ? 'on' : 'off'} — text and sound over a clip move with it`} aria-label="Linkage" onClick={() => setLinkage((l) => !l)}>
              <Icon d={ICONS.link} />
            </button>
            <button type="button" className={`ve-icon${previewAxis ? ' on' : ''}`} aria-pressed={previewAxis} title={`Preview axis ${previewAxis ? 'on' : 'off'} — hover the timeline to preview that moment`} aria-label="Preview axis" onClick={() => { setPreviewAxis((v) => !v); setHoverTime(null); }}>
              <Icon d={ICONS.axis} />
            </button>
            <span className="ve-sep" />
            <button type="button" className="ve-icon" aria-label="Zoom out" onClick={() => setPps((z) => clamp(z / 1.4, 8, 240))}>
              <Icon d={ICONS.zoomOut} />
            </button>
            <input className="ve-zoom" type="range" min={8} max={240} value={pps} aria-label="Zoom" onChange={(e) => setPps(Number(e.target.value))} />
            <button type="button" className="ve-icon" aria-label="Zoom in" onClick={() => setPps((z) => clamp(z * 1.4, 8, 240))}>
              <Icon d={ICONS.zoomIn} />
            </button>
          </div>
        </div>

        <div className="ve-tracks">
          <div className="ve-headers">
            <div className="ve-header-ruler" />
            {trackRows.map((id) => {
              const t = trackOf(id);
              return (
                <div key={id} className="ve-track-header" style={{ height: rowH(id) }}>
                  <span className="ve-track-kind">{TRACK_LABEL[id] ?? id}</span>
                  {(t?.kind === 'video' || t?.kind === 'audio') && (
                    <button type="button" className={`ve-icon tiny${t?.muted ? ' off' : ''}`} aria-label={t?.muted ? 'Unmute track' : 'Mute track'} title={t?.muted ? 'Unmute' : 'Mute'} onClick={() => toggleTrack(id, 'muted')}>
                      <Icon d={t?.muted ? ICONS.soundOff : ICONS.sound} />
                    </button>
                  )}
                  <button type="button" className={`ve-icon tiny${t?.hidden ? ' off' : ''}`} aria-label={t?.hidden ? 'Show track' : 'Hide track'} title={t?.hidden ? 'Show' : 'Hide'} onClick={() => toggleTrack(id, 'hidden')}>
                    <Icon d={t?.hidden ? ICONS.eyeOff : ICONS.eye} />
                  </button>
                </div>
              );
            })}
          </div>

          <div
            className="ve-scroll"
            ref={scrollRef}
            onPointerMove={(e) => {
              if (previewAxis && !drag.current && !scrubbing.current && !playing) setHoverTime(timeAt(e.clientX));
            }}
            onPointerLeave={() => setHoverTime(null)}
          >
            <div className="ve-content" style={{ width: laneWidth }}>
              <div className="ve-ruler" onPointerDown={scrubStart} onPointerMove={scrubMove} onPointerUp={scrubEnd}>
                {ticks.map((s) => (
                  <span key={s} className="ve-tick" style={{ left: LANE_PAD + s * pps }}>
                    {mmss(s)}
                  </span>
                ))}
              </div>
              {trackRows.map((id) => (
                <div
                  key={id}
                  className={`ve-lane${trackOf(id)?.hidden ? ' hidden' : ''}`}
                  style={{ height: rowH(id) }}
                  onPointerDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    setSelectedId(null);
                    scrubStart(e);
                  }}
                  onPointerMove={scrubMove}
                  onPointerUp={scrubEnd}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={onLaneDrop}
                >
                  {id === EDIT_MAIN_TRACK && !mainList.length && <span className="ve-lane-empty">Drag and drop media here to start creating</span>}
                  {project.clips
                    .filter((c) => c.trackId === id)
                    .map((c) => {
                      const w = Math.max(8, editClipLength(c) * pps);
                      const poster = c.source?.type === 'video' ? c.source.poster : c.source?.type === 'image' ? c.source.url : undefined;
                      const kind = editClipKind(c);
                      return (
                        <div
                          key={c.id}
                          className={`ve-clip ${kind}${c.layer ? ` ${c.layer.kind}` : ''}${c.id === selectedId ? ' on' : ''}`}
                          style={{ left: LANE_PAD + c.start * pps, width: w, backgroundImage: poster ? `url("${poster}")` : undefined }}
                          onPointerDown={(e) => beginDrag(e, 'move', c)}
                          onPointerMove={dragMove}
                          onPointerUp={endDrag}
                          title={clipLabel(c)}
                        >
                          {c.transition && <span className="ve-trans-mark" style={{ width: Math.max(6, c.transition.duration * pps) }} />}
                          <span className="ve-grip in" onPointerDown={(e) => beginDrag(e, 'in', c)} onPointerMove={dragMove} onPointerUp={endDrag} />
                          <span className="ve-clip-label">
                            {clipLabel(c)}
                            {c.speed !== 1 ? ` · ${c.speed.toFixed(2)}×` : ''}
                            {c.filter ? ` · ${EDIT_FILTERS.find((f) => f.id === c.filter!.id)?.name ?? ''}` : ''}
                          </span>
                          <span className="ve-grip out" onPointerDown={(e) => beginDrag(e, 'out', c)} onPointerMove={dragMove} onPointerUp={endDrag} />
                        </div>
                      );
                    })}
                </div>
              ))}
              <div className="ve-playhead" style={{ left: LANE_PAD + playhead * pps }} />
              {hoverTime !== null && <div className="ve-axis" style={{ left: LANE_PAD + hoverTime * pps }} />}
            </div>
          </div>
        </div>
      </section>

      {sounds.map((c) => (
        <audio
          key={c.id}
          preload="auto"
          ref={(el) => {
            if (el) soundRefs.current.set(c.id, el);
            else soundRefs.current.delete(c.id);
          }}
        />
      ))}

      {draftChoice && (
        <div className="ve-modal-wrap" role="dialog" aria-label="An earlier draft">
          <div className="ve-modal">
            <h3>You have an earlier draft of this edit</h3>
            <div className="ve-hint">
              It was made on the finished film, so its captions and logos are part of the picture and cannot be moved.
              Starting again opens them as layers you can click, drag and change.
            </div>
            <div className="ve-row end">
              <button
                type="button"
                className="ve-btn ghost"
                onClick={() => {
                  const d = draftChoice.draft;
                  setDraftChoice(null);
                  begin(d.project, d.uploads);
                }}
              >
                Continue that draft
              </button>
              <button
                type="button"
                className="ve-btn primary"
                onClick={() => {
                  const l = draftChoice.layered;
                  setDraftChoice(null);
                  begin(l);
                }}
              >
                Start with layers
              </button>
            </div>
          </div>
        </div>
      )}
      {exporting && demo && (
        <div className="ve-modal-wrap" role="dialog" aria-label="Export this edit">
          <div className="ve-modal">
            <h3>Export this edit</h3>
            <div className="ve-hint">
              Exporting is not available for viewer access. A creator exports an edit as a new version of the film,
              rendered on the server — the film it started from is always kept.
            </div>
            <div className="ve-row end">
              <button type="button" className="ve-btn primary" onClick={() => setExporting(null)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
      {exporting && !demo && (
        <div className="ve-modal-wrap" role="dialog" aria-label="Export this edit">
          <div className="ve-modal">
            <h3>Export this edit</h3>
            <label className="ve-field">
              <span>Name</span>
              <input value={exporting.label} disabled={exporting.busy} onChange={(e) => setExporting({ ...exporting, label: e.target.value })} />
            </label>
            <div className="ve-hint">
              {editTimecode(length)} at {project.aspect} · {mainList.length} clip{mainList.length === 1 ? '' : 's'} on the main track
              {project.clips.some((c) => c.text) ? ', with text' : ''}
              {sounds.length ? `, ${sounds.length} sound clip${sounds.length === 1 ? '' : 's'}` : ''}. Rendered on the server
              with ffmpeg — no model and no cost — and saved as a new version. The film you started from is untouched.
            </div>
            {exporting.error && <div className="ve-error">{exporting.error}</div>}
            <div className="ve-row end">
              <button type="button" className="ve-btn ghost" disabled={exporting.busy} onClick={() => setExporting(null)}>
                Cancel
              </button>
              <button type="button" className="ve-btn primary" disabled={exporting.busy || !exporting.label.trim()} onClick={() => void doExport()}>
                {exporting.busy ? 'Rendering…' : 'Export'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
