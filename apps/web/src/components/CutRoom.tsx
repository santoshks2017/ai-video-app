import { useEffect, useRef, useState } from 'react';
import { fmtTime } from '@ava/shared';
import { api, isApiError, type GenerationHistoryItem } from '../lib/api.js';

/**
 * The cutting room.
 *
 * Trimming a film is a full-screen job — you need to see what you are cutting —
 * so it takes the whole window rather than a strip inside a panel. Nothing here
 * involves a model: the cuts, the silence and the joins are ffmpeg, so an edit
 * costs nothing, takes seconds, and cannot change what the film shows.
 */
export function CutRoom({
  run,
  others,
  onClose,
  onExported,
}: {
  run: GenerationHistoryItem;
  /** Other finished films in this project, to join on the end. */
  others: GenerationHistoryItem[];
  onClose: () => void;
  onExported: (jobId: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [length, setLength] = useState(0);
  const [at, setAt] = useState(0);
  const [cuts, setCuts] = useState<{ from: number; to: number }[]>([]);
  const [silent, setSilent] = useState(false);
  const [append, setAppend] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const now = () => Number((video.current?.currentTime ?? 0).toFixed(2));

  /** Everything the cuts do not take out, in order. */
  const keep = (): { from: number; to: number }[] => {
    const gone = [...cuts]
      .map((c) => ({ from: Math.max(0, Math.min(length, c.from)), to: Math.max(0, Math.min(length, c.to)) }))
      .filter((c) => c.to > c.from)
      .sort((a, b) => a.from - b.from);
    const out: { from: number; to: number }[] = [];
    let mark = 0;
    for (const c of gone) {
      if (c.from > mark + 0.05) out.push({ from: mark, to: c.from });
      mark = Math.max(mark, c.to);
    }
    if (length - mark > 0.05) out.push({ from: mark, to: length });
    return out;
  };

  const kept = keep().reduce((n, k) => n + (k.to - k.from), 0);

  const exportCut = async () => {
    setBusy(true);
    setError('');
    const r = await api.editVideo(run.jobId, {
      keep: keep(),
      mute: silent,
      append,
      note: `Edited cut${cuts.length ? ` · ${cuts.length} removed` : ''}${append.length ? ` · ${append.length} joined` : ''}`,
    });
    setBusy(false);
    if (isApiError(r)) {
      setError(r.message);
      return;
    }
    onExported(r.jobId);
  };

  return (
    <div className="cutroom-wrap" role="dialog" aria-label="Cutting room">
      <header className="cutroom-head">
        <div className="head-left">
          <h2>Cutting room</h2>
          <span className="step">{run.label ?? 'this film'}</span>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <span className="hint" style={{ marginTop: 0 }}>
            No model, no cost — ffmpeg only.
          </span>
          <button className="btn ghost small" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      <div className="cutroom-body">
        <div className="cutroom-stage">
          {run.finalUrl && (
            <video
              ref={video}
              src={run.finalUrl}
              controls
              playsInline
              onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
            />
          )}
          {/* What survives the cuts, drawn along the film's own length. */}
          <div className="cut-track" aria-hidden>
            {keep().map((k, i) => (
              <span
                className="cut-keep"
                key={i}
                style={{ left: `${(k.from / (length || 1)) * 100}%`, width: `${((k.to - k.from) / (length || 1)) * 100}%` }}
              />
            ))}
            <span className="cut-head" style={{ left: `${(at / (length || 1)) * 100}%` }} />
          </div>
          <div className="cut-clock">
            {fmtTime(at)} / {fmtTime(length)} · keeping {fmtTime(kept)}
            {append.length ? ` + ${append.length} joined on the end` : ''}
          </div>
        </div>

        <aside className="cutroom-side">
          <h3>Take out</h3>
          <div className="cut-help">
            Play to where a bad stretch starts and press <b>Cut from here</b>; play to its end and press{' '}
            <b>to here</b>.
          </div>
          <button
            className="btn small"
            type="button"
            onClick={() => setCuts((c) => [...c, { from: now(), to: Math.min(length, now() + 1) }])}
          >
            Cut from here
          </button>
          {cuts.map((c, i) => (
            <div className="cut-row" key={i}>
              <span className="cut-no">{i + 1}</span>
              <input
                type="number"
                step="0.1"
                min={0}
                max={length || undefined}
                value={c.from}
                aria-label={`Cut ${i + 1} starts at`}
                onChange={(e) => setCuts((cur) => cur.map((x, j) => (j === i ? { ...x, from: Number(e.target.value) } : x)))}
              />
              <span>to</span>
              <input
                type="number"
                step="0.1"
                min={0}
                max={length || undefined}
                value={c.to}
                aria-label={`Cut ${i + 1} ends at`}
                onChange={(e) => setCuts((cur) => cur.map((x, j) => (j === i ? { ...x, to: Number(e.target.value) } : x)))}
              />
              <button
                className="btn ghost small"
                type="button"
                onClick={() => setCuts((cur) => cur.map((x, j) => (j === i ? { ...x, to: now() } : x)))}
              >
                to here
              </button>
              <button
                className="btn ghost small"
                type="button"
                aria-label={`Remove cut ${i + 1}`}
                onClick={() => setCuts((cur) => cur.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}

          <h3>Sound</h3>
          <div className="check-row">
            <input type="checkbox" id="cut-silent" checked={silent} onChange={(e) => setSilent(e.target.checked)} />
            <label htmlFor="cut-silent">Drop the sound entirely</label>
          </div>

          <h3>Join on the end</h3>
          {others.length === 0 ? (
            <div className="hint">Nothing else finished in this project yet.</div>
          ) : (
            <div className="join-list">
              {append.map((id, i) => {
                const o = others.find((x) => x.jobId === id);
                return (
                  <div className="join-row on" key={`${id}-${i}`}>
                    <span className="cut-no">{i + 1}</span>
                    <b>{o?.label ?? id.slice(0, 8)}</b>
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => setAppend((a) => a.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              {others
                .filter((o) => !append.includes(o.jobId))
                .map((o) => (
                  <button
                    className="join-row"
                    type="button"
                    key={o.jobId}
                    onClick={() => setAppend((a) => [...a, o.jobId])}
                  >
                    <b>{o.label ?? o.jobId.slice(0, 8)}</b>
                    <span>
                      {new Date(o.createdAt).toLocaleDateString()}
                      {o.totalSeconds ? ` · ${o.totalSeconds}s` : ''}
                    </span>
                  </button>
                ))}
            </div>
          )}

          {error && (
            <div className="check bad">
              <span className="icon">✕</span>
              <span>{error}</span>
            </div>
          )}
          <button
            className="btn primary"
            type="button"
            disabled={busy || !length || (!cuts.length && !silent && !append.length)}
            onClick={() => void exportCut()}
          >
            {busy ? 'Exporting…' : 'Export this cut'}
          </button>
          <div className="hint">Saved as a new version. The film you started from is untouched.</div>
        </aside>
      </div>
    </div>
  );
}
