import { useEffect, useRef, useState } from 'react';
import { fmtTime, type Brief, type PromptPart, type ScenePlan } from '@ava/shared';
import { api, isApiError, type ClipView, type GenerateResult } from '../lib/api.js';

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
}: {
  brief: Brief;
  parts: PromptPart[];
  scenePlan: ScenePlan | null;
  canGenerate: boolean;
  needsCostConfirm: boolean;
  costInr: number;
}) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Recover an in-flight/finished job across reloads.
  useEffect(() => {
    const saved = localStorage.getItem('ava.lastJob');
    if (!saved) return;
    api.job(saved).then((r) => {
      if (!isApiError(r)) {
        setResult(r);
        setStatus(r.status === 'done' ? 'done' : r.status === 'failed' ? 'error' : 'running');
      }
    });
  }, []);

  const run = async () => {
    setStatus('running');
    setError('');
    setResult(null);
    const r = await api.generate(brief, parts, needsCostConfirm ? costInr : undefined);
    if (isApiError(r)) {
      setStatus('error');
      setError(`${r.code}: ${r.message}`);
      if (r.jobId) localStorage.setItem('ava.lastJob', r.jobId);
      if (r.clips?.length) setResult({ jobId: r.jobId ?? '', status: 'failed', clips: r.clips });
      return;
    }
    localStorage.setItem('ava.lastJob', r.jobId);
    setResult(r);
    setStatus(r.status === 'done' ? 'done' : 'running');
  };

  const clips: ClipView[] = result?.clips ?? [];
  const doneClips = clips.filter((c) => c.status === 'done' && c.url);
  const finalSrc =
    result?.finalUrl ?? (doneClips.find((c) => c.isFinal) ?? doneClips.at(-1))?.url ?? null;
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
        <span className="step">Omni Flash · P0.1 / P0.10</span>
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
