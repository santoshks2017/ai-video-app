import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtTime, formatInr, type Brief, type PromptPart, type ScenePlan } from '@ava/shared';
import {
  api,
  isApiError,
  errorClips,
  type ClipView,
  type GenerateResult,
  type GenerationHistoryItem,
} from '../lib/api.js';

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

  const loadHistory = useCallback(async () => {
    if (!project?.id) return;
    setHistory(await api.history(project.id));
  }, [project?.id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const run = async () => {
    setStatus('running');
    setError('');
    setResult(null);
    const r = await api.generate(brief, parts, needsCostConfirm ? costInr : undefined, modelId, project);
    if (isApiError(r)) {
      setStatus('error');
      setError(`${r.code}: ${r.message}`);
      const partial = errorClips(r);
      void loadHistory();
      if (partial.length) setResult({ jobId: r.jobId ?? '', status: 'failed', clips: partial });
      return;
    }
    setResult(r);
    setViewing(null);
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
  const totalDuration = scenePlan?.scenes.at(-1)?.end ?? 0;

  const seekTo = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, t);
  };

  const blocked = !canGenerate || parts.length === 0 || (needsCostConfirm && !confirmed);
  const failed = clips.filter((c) => c.status === 'failed');

  return (
    <div className="card">
      <div className="head">
        <h2>Generate &amp; preview</h2>
        <span className="step">{modelLabel ?? 'default model'}</span>
      </div>
      <div className="body tight">
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
          {status === 'running' && (
            <span className="hint">
              {parts.length > 1 ? `${parts.length} segments, ` : ''}a minute or two per segment — keep this tab
              open.
            </span>
          )}
        </div>

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
                      title={`${sc.beat.title} · ${fmtTime(sc.start)}–${fmtTime(sc.end)}`}
                      onClick={() => seekTo(sc.start)}
                    >
                      <span className="tl-t">{sc.beat.title}</span>
                      <span className="tl-time">{fmtTime(sc.start)}</span>
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
                    </b>
                    <span>
                      {[
                        h.totalSeconds ? `${h.totalSeconds}s` : null,
                        h.aspect,
                        h.resolution,
                        h.segments ? `${h.segments} segment${h.segments > 1 ? 's' : ''}` : null,
                        h.modelName,
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
