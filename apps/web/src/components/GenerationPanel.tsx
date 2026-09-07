import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime, type Brief, type PromptPart, type ScenePlan } from '@ava/shared';
import { api, isApiError, type ClipView, type GenerateResult } from '../lib/api.js';

/**
 * PRD P0.1 + P0.10 — runs the real generation and shows the finished clips with
 * a frame timeline that maps each storyboard scene back to its clip. Per-part
 * re-generate lives here too (a bad part doesn't force redoing the whole video).
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
  const [active, setActive] = useState(1);
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

  const clipByPart = useMemo(() => {
    const m = new Map<number, ClipView>();
    result?.clips.forEach((c) => m.set(c.partNum, c));
    return m;
  }, [result]);

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

  const jumpToScene = (sceneStart: number, part: number) => {
    setActive(part);
    const clip = clipByPart.get(part);
    if (!clip) return;
    window.requestAnimationFrame(() => {
      if (videoRef.current) videoRef.current.currentTime = Math.max(0, sceneStart - clip.start);
    });
  };

  const activeClip = clipByPart.get(active);
  const blocked = !canGenerate || parts.length === 0 || (needsCostConfirm && !confirmed);

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
            {status === 'running' ? 'Generating…' : status === 'done' ? 'Regenerate all' : 'Generate video'}
          </button>
          {status === 'running' && <span className="hint">Each clip takes a minute or two — keep this tab open.</span>}
        </div>

        {status === 'error' && <div className="check bad" style={{ marginTop: 10 }}><span className="icon">✕</span><span>{error}</span></div>}

        {result && (
          <>
            <div className="clip-strip">
              {result.clips.map((c) => (
                <button
                  key={c.partNum}
                  className={`clip-tab${c.partNum === active ? ' on' : ''} ${c.status}`}
                  onClick={() => setActive(c.partNum)}
                >
                  Part {c.partNum}
                  <span>
                    {c.status === 'done' ? `${fmtTime(c.start)}–${fmtTime(c.end)}` : c.status}
                  </span>
                </button>
              ))}
            </div>

            {activeClip?.url ? (
              <video ref={videoRef} className="clip-video" src={activeClip.url} controls playsInline />
            ) : (
              <div className="prompt-empty" style={{ padding: 24 }}>
                {activeClip?.status === 'failed'
                  ? `Part ${active} failed: ${activeClip.error ?? 'unknown error'}`
                  : `Part ${active} is still rendering…`}
              </div>
            )}

            {scenePlan && (
              <div className="timeline">
                <div className="timeline-label">Frame timeline — click a scene to jump</div>
                <div className="timeline-track">
                  {scenePlan.scenes.map((sc, i) => {
                    const pct = (sc.duration / (scenePlan.scenes.at(-1)?.end || 1)) * 100;
                    const clip = clipByPart.get(sc.part + 1);
                    return (
                      <button
                        key={i}
                        className={`tl-seg part-${(sc.part % 4) + 1}${sc.part + 1 === active ? ' on' : ''}`}
                        style={{ flexGrow: pct }}
                        title={`${sc.beat.title} · ${fmtTime(sc.start)}–${fmtTime(sc.end)}`}
                        onClick={() => jumpToScene(sc.start, sc.part + 1)}
                        disabled={!clip || clip.status !== 'done'}
                      >
                        <span className="tl-t">{sc.beat.title}</span>
                        <span className="tl-time">{fmtTime(sc.start)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {status === 'idle' && !result && (
          <div className="hint" style={{ marginTop: 8 }}>
            Runs part 1 as a fresh generation, then each further part as an <code>extend</code> on the previous
            clip (Omni Flash conversational continuity). Clips are stored server-side and streamed back here.
          </div>
        )}
      </div>
    </div>
  );
}
