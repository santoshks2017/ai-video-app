import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtTime, formatInr, type Brief, type PromptPart, type ScenePlan, clampPace } from '@ava/shared';
import { useApp } from '../state/appStore.js';
import {
  api,
  isApiError,
  errorClips,
  type ClipView,
  type GenerateResult,
  type GenerationHistoryItem,
} from '../lib/api.js';
import { GenTimer, fmtDur, type Eta } from './GenTimer.js';

/**
 * PRD P0.1 + P0.10 — runs the real generation and shows the ONE finished video
 * (Omni Flash extend output is cumulative: the last segment is the whole video)
 * with a frame timeline that seeks to each storyboard scene.
 */
export function GenerationPanel({
  brief,
  parts,
  scenePlan,
  canGenerate,
  needsCostConfirm,
  costInr,
  modelId,
  modelLabel,
  project,
  sceneOverrides,
  resolution,
  onGenerated,
}: {
  brief: Brief;
  parts: PromptPart[];
  scenePlan: ScenePlan | null;
  canGenerate: boolean;
  needsCostConfirm: boolean;
  costInr: number;
  /** Which registered model to generate with. */
  modelId?: string;
  modelLabel?: string;
  /** Storyboard edits — the edited captions are composited from these. */
  sceneOverrides?: Record<string, unknown>;
  /** The deliverable resolution, for the time estimate. */
  resolution?: string;
  /** Files each run under this project so its history survives regeneration. */
  project?: { id: string; name: string };
  /** Lets the caller record the finished job against a project. */
  onGenerated?: (jobId: string, finalUrl: string | null) => void;
}) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [history, setHistory] = useState<GenerationHistoryItem[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  // Refine: retake only the segments a reviewer flags, re-use the rest.
  const [feedback, setFeedback] = useState('');
  const [redo, setRedo] = useState<number[]>([]);
  const [refineStatus, setRefineStatus] = useState<'idle' | 'running'>('idle');
  const [refineErr, setRefineErr] = useState('');
  const [refineConfirmed, setRefineConfirmed] = useState(false);
  /** Clips of jobs opened from history — the list payload doesn't carry them. */
  const [jobClips, setJobClips] = useState<Record<string, ClipView[]>>({});
  // Tell the workspace this project is busy, so its tab says so from anywhere.
  const setProjectBusy = useApp((s) => s.setProjectBusy);
  const canGenerateRole = useApp((s) => s.can('creator'));
  const projectId = project?.id;
  useEffect(() => {
    if (!projectId) return;
    const busy = status === 'running' || refineStatus === 'running';
    setProjectBusy(projectId, busy);
    return () => setProjectBusy(projectId, false);
  }, [projectId, status, refineStatus, setProjectBusy]);

  const loadHistory = useCallback(async () => {
    if (!project?.id) return;
    setHistory(await api.history(project.id));
  }, [project?.id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // How long a run should take, from this app's own history on the model.
  const videoSeconds = Math.round(parts.reduce((a, p) => a + p.duration, 0));
  const [eta, setEta] = useState<Eta | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const loadEta = useCallback(async () => {
    if (!videoSeconds) return;
    const r = await api.eta({ modelId, resolution: resolution ?? '720p', seconds: videoSeconds, parts: parts.length });
    if (!isApiError(r)) setEta(r);
  }, [modelId, resolution, videoSeconds, parts.length]);
  useEffect(() => {
    void loadEta();
  }, [loadEta]);
  // A one-second tick, only while a run is in flight.
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const run = async () => {
    setStatus('running');
    setError('');
    setResult(null);
    setStartedAt(Date.now());
    setNow(Date.now());
    const r = await api.generate(
      brief,
      parts,
      needsCostConfirm ? costInr : undefined,
      modelId,
      project,
      sceneOverrides,
    );
    setStartedAt(null);
    void loadEta();
    if (isApiError(r)) {
      setStatus('error');
      // "Failed to fetch" means no answer came back at all: the connection was cut
      // before the video finished. Say that, rather than a browser error string.
      setError(
        r.code === 'network'
          ? 'Lost the connection to the server before the video finished — the server may have restarted, or your connection dropped. Check History: an unfinished run shows as interrupted, and you can generate again.'
          : `${r.code}: ${r.message}`,
      );
      const partial = errorClips(r);
      void loadHistory();
      if (partial.length) setResult({ jobId: r.jobId ?? '', status: 'failed', clips: partial });
      return;
    }
    setResult(r);
    setViewing(null);
    setRedo([]);
    setFeedback('');
    setRefineErr('');
    setStatus(r.status === 'done' ? 'done' : 'running');
    onGenerated?.(r.jobId, r.finalUrl ?? null);
    void loadHistory();
  };

  const clips: ClipView[] = result?.clips ?? [];
  const doneClips = clips.filter((c) => c.status === 'done' && c.url);
  const viewingItem = viewing ? history.find((h) => h.jobId === viewing) : undefined;
  const finalSrc =
    viewingItem?.finalUrl ??
    result?.finalUrl ??
    (doneClips.find((c) => c.isFinal) ?? doneClips.at(-1))?.url ??
    // Nothing generated this session — fall back to the newest saved run.
    history.find((h) => h.finalUrl)?.finalUrl ??
    null;
  // The storyboard's pace speeds the finished film up, so its timeline runs shorter than the plan.
  const speed = clampPace(brief.pace);
  const totalDuration = Math.round(((scenePlan?.scenes.at(-1)?.end ?? 0) / speed) * 10) / 10;

  const seekTo = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, t);
  };

  const blocked = !canGenerateRole || !canGenerate || parts.length === 0 || (needsCostConfirm && !confirmed);
  const failed = clips.filter((c) => c.status === 'failed');

  /* ---- refine: retake the bad segments only ---- */
  const activeJobId = viewing ?? result?.jobId ?? history.find((h) => h.finalUrl)?.jobId ?? null;
  const activeClips: ClipView[] =
    result?.jobId && result.jobId === activeJobId ? result.clips : (jobClips[activeJobId ?? ''] ?? []);

  useEffect(() => {
    if (!activeJobId || jobClips[activeJobId] || result?.jobId === activeJobId) return;
    let live = true;
    void api.job(activeJobId).then((j) => {
      if (live && !isApiError(j)) setJobClips((m) => ({ ...m, [activeJobId]: j.clips }));
    });
    return () => {
      live = false;
    };
  }, [activeJobId, jobClips, result?.jobId]);

  const clipsLoading = Boolean(activeJobId) && result?.jobId !== activeJobId && !jobClips[activeJobId ?? ''];
  // A retake splices new segments into the saved ones, so the plan has to be the
  // same shape it was when they were made.
  const canRefine =
    Boolean(activeJobId) &&
    parts.length > 0 &&
    activeClips.filter((c) => c.status === 'done').length === parts.length;
  const partSeconds = parts.reduce((a, p) => a + p.duration, 0);
  const redoSeconds = Math.round(parts.filter((p) => redo.includes(p.partNum)).reduce((a, p) => a + p.duration, 0) * 10) / 10;
  // Cost is linear in generated seconds, so the share of the full estimate is exact.
  const refineInr = partSeconds > 0 ? Math.round((costInr * redoSeconds) / partSeconds) : 0;
  const refineNeedsConfirm = refineInr > 500;

  const toggleRedo = (partNum: number) =>
    setRedo((r) => (r.includes(partNum) ? r.filter((n) => n !== partNum) : [...r, partNum].sort((a, b) => a - b)));

  const runRefine = async () => {
    if (!activeJobId) return;
    setRefineStatus('running');
    setRefineErr('');
    const r = await api.refine(
      activeJobId,
      brief,
      parts,
      redo,
      feedback,
      refineNeedsConfirm ? refineInr : undefined,
      modelId,
      project,
      sceneOverrides,
    );
    setRefineStatus('idle');
    if (isApiError(r)) {
      setRefineErr(`${r.code}: ${r.message}`);
      void loadHistory();
      return;
    }
    setResult(r);
    setViewing(null);
    setStatus('done');
    setRedo([]);
    setRefineConfirmed(false);
    onGenerated?.(r.jobId, r.finalUrl ?? null);
    void loadHistory();
  };

  return (
    <div className="card">
      <div className="head">
        <h2>Generate &amp; preview</h2>
        <span className="step">{modelLabel ?? 'default model'}</span>
      </div>
      <div className="body tight">
        {!canGenerateRole && (
          <div className="check warn" style={{ marginBottom: 10 }}>
            <span className="icon">!</span>
            <span>
              Your account can watch videos but not generate them — generating spends real money. Ask an admin
              to make you a creator in People.
            </span>
          </div>
        )}

        {needsCostConfirm && status === 'idle' && (
          <label className="check-row">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>Over ₹500 (est. ₹{costInr.toLocaleString('en-IN')}) — confirm the spend.</span>
          </label>
        )}

        <div className="toolbar" style={{ marginTop: 0 }}>
          <button
            className="btn primary"
            disabled={blocked || status === 'running'}
            onClick={run}
            title={!canGenerate ? 'Resolve the blocking pre-flight checks first' : ''}
          >
            {status === 'running'
              ? 'Generating…'
              : status === 'done' || status === 'error'
                ? 'Regenerate'
                : 'Generate video'}
          </button>
          {status !== 'running' && eta && (
            <span className="hint">Usually ready in about {fmtDur(eta.seconds)}</span>
          )}
        </div>

        {status === 'running' && startedAt && (
          <GenTimer startedAt={startedAt} now={now} eta={eta} segments={parts.length} />
        )}

        {status === 'error' && (
          <div className="check bad" style={{ marginTop: 10 }}>
            <span className="icon">✕</span>
            <span>{error}</span>
          </div>
        )}

        {finalSrc ? (
          <>
            <video
              ref={videoRef}
              className="clip-video"
              src={finalSrc}
              controls
              playsInline
              style={{ marginTop: 10 }}
            />

            {scenePlan && totalDuration > 0 && (
              <div className="timeline">
                <div className="timeline-label">Frame timeline — click a scene to jump</div>
                <div className="timeline-track">
                  {scenePlan.scenes.map((sc, i) => (
                    <button
                      key={i}
                      className={`tl-seg part-${(sc.part % 4) + 1}`}
                      style={{ flexGrow: sc.duration / totalDuration }}
                      title={`${sc.beat.title} · ${fmtTime(sc.start / speed)}–${fmtTime(sc.end / speed)}`}
                      onClick={() => seekTo(sc.start / speed)}
                    >
                      <span className="tl-t">{sc.beat.title}</span>
                      <span className="tl-time">{fmtTime(sc.start / speed)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {clips.length > 1 && (
              <details style={{ marginTop: 10 }}>
                <summary className="hint" style={{ cursor: 'pointer' }}>
                  Built from {doneClips.length}/{clips.length} segments
                  {failed.length ? ` — ${failed.length} failed` : ''}
                </summary>
                <div className="clip-strip" style={{ marginTop: 8 }}>
                  {clips.map((c) => (
                    <a
                      key={c.partNum}
                      className={`clip-tab ${c.status}`}
                      href={c.url ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Segment {c.partNum}
                      <span>{c.status === 'done' ? `→ ${fmtTime(c.end)}` : c.status}</span>
                    </a>
                  ))}
                </div>
                {failed.map((c) => (
                  <div key={c.partNum} className="hint" style={{ color: 'var(--bad)' }}>
                    Segment {c.partNum}: {c.error ?? 'unknown error'}
                  </div>
                ))}
              </details>
            )}
          </>
        ) : (
          status !== 'idle' &&
          status !== 'error' && (
            <div className="prompt-empty" style={{ padding: 24 }}>
              Rendering…
            </div>
          )
        )}

        {finalSrc && activeJobId && status !== 'running' && (
          <details className="refine">
            <summary>Almost right? Fix a detail without paying for a full regenerate</summary>
            <div className="refine-body">
              {clipsLoading ? (
                <div className="hint">Checking which segments were saved…</div>
              ) : !canRefine ? (
                <div className="check warn">
                  <span className="icon">!</span>
                  <span>
                    The storyboard has changed since this video was made
                    {activeClips.length ? ` (${activeClips.length} saved segments, ${parts.length} now)` : ''}, so its
                    segments can no longer be re-used. Generate a fresh video instead.
                  </span>
                </div>
              ) : (
                <>
                  <textarea
                    rows={3}
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder={
                      'What needs fixing? One point per line —\n' +
                      'presenter should not point at the camera\n' +
                      'park the car further from the entrance'
                    }
                  />
                  <div className="refine-label">
                    Which segments need the retake? Anything left unticked is re-used exactly as it is, and costs
                    nothing.
                  </div>
                  <div className="refine-segs">
                    {parts.map((p) => {
                      const titles = (scenePlan?.scenes ?? [])
                        .filter((sc) => sc.part === p.partNum - 1)
                        .map((sc) => sc.beat.title);
                      const on = redo.includes(p.partNum);
                      return (
                        <label key={p.partNum} className={`refine-seg${on ? ' on' : ''}`}>
                          <input type="checkbox" checked={on} onChange={() => toggleRedo(p.partNum)} />
                          <span>
                            <b>
                              Segment {p.partNum} · {p.duration}s
                            </b>
                            <em>{titles.join(' → ') || `${fmtTime(p.start)}–${fmtTime(p.end)}`}</em>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="refine-cost">
                    {redo.length === 0
                      ? 'Nothing ticked — restitches the saved segments with the current footer, logos and end card. Free.'
                      : `${redo.length} of ${parts.length} segment${parts.length > 1 ? 's' : ''} · ${redoSeconds}s to regenerate · ${formatInr(refineInr)} instead of ${formatInr(costInr)}.`}
                  </div>
                  {refineNeedsConfirm && (
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={refineConfirmed}
                        onChange={(e) => setRefineConfirmed(e.target.checked)}
                      />
                      <span>Over ₹500 (est. ₹{refineInr.toLocaleString('en-IN')}) — confirm the spend.</span>
                    </label>
                  )}
                  <div className="toolbar" style={{ marginTop: 8 }}>
                    <button
                      className="btn primary"
                      disabled={!canGenerateRole || refineStatus === 'running' || (refineNeedsConfirm && !refineConfirmed)}
                      onClick={runRefine}
                    >
                      {refineStatus === 'running'
                        ? 'Working…'
                        : redo.length === 0
                          ? 'Restitch — free'
                          : `Retake ${redo.length} segment${redo.length > 1 ? 's' : ''}`}
                    </button>
                    {redo.length > 0 && !feedback.trim() && (
                      <span className="hint">No note — the segment is simply rolled again.</span>
                    )}
                  </div>
                  <div className="hint">
                    The retake is seeded from the frame that precedes it and told to keep everything else identical, so
                    it still cuts against its neighbours. The original stays in history either way.
                  </div>
                  {refineErr && (
                    <div className="check bad" style={{ marginTop: 8 }}>
                      <span className="icon">✕</span>
                      <span>{refineErr}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </details>
        )}

        {history.length > 0 && (
          <div className="history">
            <div className="history-head">
              <span>
                History — {history.length} generation{history.length > 1 ? 's' : ''}
              </span>
              <span className="history-total">
                {formatInr(history.reduce((sum, h) => sum + (h.costInr ?? 0), 0))} total
              </span>
            </div>
            {history.map((h) => {
              const on = (viewing ?? result?.jobId ?? history.find((x) => x.finalUrl)?.jobId) === h.jobId;
              return (
                <button
                  key={h.jobId}
                  type="button"
                  className={`hist-row${on ? ' on' : ''}`}
                  disabled={!h.finalUrl}
                  onClick={() => setViewing(h.jobId)}
                >
                  {h.posterUrl ? (
                    <img src={h.posterUrl} alt="" />
                  ) : (
                    <span className={`hist-ph s-${h.status}`}>{h.status === 'failed' ? '!' : '…'}</span>
                  )}
                  <span className="hist-meta">
                    <b>
                      {new Date(h.createdAt).toLocaleString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {h.status !== 'done' && <span className={`badge s-${h.status}`}>{h.status}</span>}
                      {h.parentJobId && <span className="badge retake">retake</span>}
                    </b>
                    <span>
                      {[
                        h.parentJobId ? h.label : null,
                        h.totalSeconds ? `${h.totalSeconds}s` : null,
                        h.aspect,
                        h.renderResolution ? `${h.resolution} (upscaled from ${h.renderResolution})` : h.resolution,
                        h.segments ? `${h.segments} segment${h.segments > 1 ? 's' : ''}` : null,
                        h.modelName,
                        h.durationMs
                          ? `${h.status === 'failed' ? 'failed after' : 'took'} ${fmtDur(h.durationMs / 1000)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {h.error && <span className="hist-err">{h.error}</span>}
                  </span>
                  <span className="hist-cost">
                    {h.costInr != null ? formatInr(h.costInr) : '—'}
                    {h.usdPerSecond ? <em>${h.usdPerSecond}/s</em> : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {status === 'idle' && !result && (
          <div className="hint" style={{ marginTop: 8 }}>
            {parts.length > 1
              ? `~${totalDuration}s video: generated in ${parts.length} segments (extend where possible, ffmpeg-stitched otherwise) and returned as one clip.`
              : 'Generates one clip and shows it here with a scene timeline.'}
          </div>
        )}
      </div>
    </div>
  );
}
