import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtTime } from '@ava/shared';
import { api, isApiError, type GenerationHistoryItem } from '../lib/api.js';

/**
 * The cutting room.
 *
 * Trimming a film is a full-screen job — you need to see what you are cutting —
 * so it takes the whole window rather than a strip inside a panel. It is drawn
 * into the body rather than where it sits in the tree: nested, the rail painted
 * over its left edge whatever its z-index, and the window clipped its foot.
 *
 * Nothing here involves a model: the cuts, the silence and the joins are ffmpeg,
 * so an edit costs nothing, takes seconds, and cannot change what the film shows.
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
  const [playing, setPlaying] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const now = () => Number((video.current?.currentTime ?? 0).toFixed(2));

  /** Seek from a point on the track — click anywhere, or drag along it. */
  const seekFrom = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || !length || !video.current) return;
    const at = Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * length;
    video.current.currentTime = at;
    setAt(at);
  };

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

  return createPortal(
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
          {/* A screen of fixed size that the film fits inside. The other way round —
              the frame sizing itself to the film — moved every control on the page
              the moment a 9:16 film loaded. */}
          <div className="cut-screen">
          {run.finalUrl && (
            <video
              ref={video}
              src={run.finalUrl}
              controls
              playsInline
              onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          )}
          </div>
          {/* The film's length: what survives the cuts, and where the playhead is.
              It is the scrubber too — click anywhere on it, or drag along it. */}
          <div
            className="cut-track"
            ref={track}
            role="slider"
            tabIndex={0}
            aria-label="Position in the film"
            aria-valuemin={0}
            aria-valuemax={Math.round(length)}
            aria-valuenow={Math.round(at)}
            onPointerDown={(e) => {
              scrubbing.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              seekFrom(e.clientX);
            }}
            onPointerMove={(e) => scrubbing.current && seekFrom(e.clientX)}
            onPointerUp={(e) => {
              scrubbing.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onKeyDown={(e) => {
              if (!video.current) return;
              const step = e.shiftKey ? 1 : 0.1;
              if (e.key === 'ArrowLeft') video.current.currentTime = Math.max(0, at - step);
              if (e.key === 'ArrowRight') video.current.currentTime = Math.min(length, at + step);
            }}
          >
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
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                const v = video.current;
                if (!v) return;
                if (v.paused) void v.play();
                else v.pause();
              }}
            >
              {playing ? '❙❙ Pause' : '▶ Play'}
            </button>
            <span>
              {fmtTime(at)} / {fmtTime(length)} · keeping {fmtTime(kept)}
              {append.length ? ` + ${append.length} joined on the end` : ''}
            </span>
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
    </div>,
    document.body,
  );
}
