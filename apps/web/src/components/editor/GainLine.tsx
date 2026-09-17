import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  addGainPoint,
  dbAt,
  dbFromGain,
  gainFromDb,
  editClipLength,
  moveGainPoint,
  removeGainPoint,
  GAIN_CEILING_DB,
  GAIN_FLOOR_DB,
  type EditClip,
  type GainPoint,
} from '@ava/shared';

/*
 * A sound clip's volume line, drawn on its bar in the timeline.
 *
 * The film's music opens with the film's dips as key points. A point drags up and down
 * (Shift keeps it at its moment, Alt stops it catching on the clip's own level); clicking
 * the line adds a point where it is, at the level the line already has there, and
 * double-clicking a point removes it.
 */

const PAD = 5;
/*
 * Level to height on the bar, on a fader's scale rather than a straight dB one: +6 dB at the
 * top, -40 dB at the bottom, and the levels music is mixed at (0 to -24 dB) given most of the
 * room — a -12 dB dip drops over a third of the bar instead of a sixth.
 */
const TOP = Math.sqrt(gainFromDb(GAIN_CEILING_DB));
const BOTTOM = Math.sqrt(gainFromDb(GAIN_FLOOR_DB));
const yOf = (db: number, h: number): number => PAD + ((TOP - Math.sqrt(gainFromDb(db))) / (TOP - BOTTOM)) * (h - PAD * 2);
const dbOfY = (y: number, h: number): number => {
  const f = Math.max(0, Math.min(1, (y - PAD) / (h - PAD * 2)));
  const r = TOP - f * (TOP - BOTTOM);
  return dbFromGain(r * r);
};

export const formatDb = (db: number): string => `${db > 0.04 ? '+' : db < -0.04 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;
export const formatMoment = (sec: number): string => {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
/** Where a moment on the clip's source plays on the timeline. */
const onTimeline = (c: EditClip, t: number): number => c.start + (t - c.in) / (c.speed || 1);

export function GainLine({
  clip,
  pps,
  height,
  selected,
  readOnly,
  onSelect,
  onBegin,
  onChange,
  onEnd,
}: {
  clip: EditClip;
  /** Pixels per second of the timeline. */
  pps: number;
  height: number;
  selected: number | null;
  readOnly: boolean;
  onSelect: (index: number | null) => void;
  /** A gesture starts: what it changes is one undo step. */
  onBegin: () => void;
  onChange: (gain: GainPoint[]) => void;
  onEnd: () => void;
}) {
  const points = clip.gain ?? [];
  const speed = clip.speed || 1;
  const width = Math.max(8, editClipLength(clip) * pps);
  const xOf = (t: number): number => ((t - clip.in) / speed) * pps;
  const tOf = (x: number): number => clip.in + (x / pps) * speed;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; points: GainPoint[] } | null>(null);
  const [tip, setTip] = useState<number | null>(null);

  const xs: number[] = [];
  for (let x = 0; x < width; x += 3) xs.push(x);
  for (const p of points) {
    const x = xOf(p.t);
    if (x > 0 && x < width) xs.push(x - 0.01, x);
  }
  xs.push(width);
  xs.sort((a, b) => a - b);
  const path = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${yOf(dbAt(points, tOf(x)), height).toFixed(1)}`).join('');

  const local = (e: ReactPointerEvent): { x: number; y: number } => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const grab = (e: ReactPointerEvent, index: number, from: GainPoint[]): void => {
    e.stopPropagation();
    e.preventDefault();
    svg.current?.setPointerCapture(e.pointerId);
    drag.current = { index, points: from };
    onSelect(index);
    setTip(index);
  };

  const onLineDown = (e: ReactPointerEvent): void => {
    const { points: next, index } = addGainPoint(points, tOf(local(e).x));
    if (index < 0) return;
    onBegin();
    grab(e, index, next);
    onChange(next);
  };
  // A second press on the same point removes it. Found here rather than from dblclick: the
  // first press captures the pointer, so the browser sends the double-click to the line.
  const lastPress = useRef<{ index: number; at: number } | null>(null);
  const onPointDown = (e: ReactPointerEvent, index: number): void => {
    if (readOnly) {
      e.stopPropagation();
      onSelect(index);
      return;
    }
    const again = lastPress.current?.index === index && e.timeStamp - lastPress.current.at < 400;
    lastPress.current = again ? null : { index, at: e.timeStamp };
    if (again) {
      e.stopPropagation();
      e.preventDefault();
      onBegin();
      onChange(removeGainPoint(points, index));
      onEnd();
      onSelect(null);
      return;
    }
    onBegin();
    grab(e, index, points);
  };
  const onMove = (e: ReactPointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = local(e);
    const p = d.points[d.index]!;
    // Catches on the clip's own level when it comes within a few pixels of it.
    const db = !e.altKey && Math.abs(y - yOf(0, height)) <= 4 ? 0 : dbOfY(y, height);
    const t = e.shiftKey ? p.t : Math.max(clip.in, Math.min(clip.out, tOf(x)));
    d.points = moveGainPoint(d.points, d.index, t, db);
    onChange(d.points);
  };
  const onUp = (): void => {
    if (!drag.current) return;
    drag.current = null;
    setTip(null);
    onEnd();
  };
  const shown = tip !== null ? points[tip] : undefined;
  return (
    <svg
      ref={svg}
      className={`ve-gain${readOnly ? ' read-only' : ''}`}
      width={width}
      height={height}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      aria-label={`Volume line, ${points.length} key point${points.length === 1 ? '' : 's'}`}
    >
      <path className="ve-gain-hit" d={path} onPointerDown={readOnly ? undefined : onLineDown}>
        <title>Click to add a key point</title>
      </path>
      <path className="ve-gain-line" d={path} />
      {points.map((p, i) => {
        const x = xOf(p.t);
        if (x < -6 || x > width + 6) return null;
        return (
          <circle
            key={i}
            className={`ve-gain-point${i === selected ? ' on' : ''}`}
            cx={x}
            cy={yOf(p.db, height)}
            r={i === selected ? 5 : 4}
            onPointerDown={(e) => onPointDown(e, i)}
          >
            <title>{`${formatDb(p.db)} at ${formatMoment(onTimeline(clip, p.t))}`}</title>
          </circle>
        );
      })}
      {shown && (
        <text
          className="ve-gain-tip"
          x={Math.min(width - 4, Math.max(4, xOf(shown.t) + 8))}
          y={yOf(shown.db, height) < height / 2 ? yOf(shown.db, height) + 16 : yOf(shown.db, height) - 8}
          textAnchor={xOf(shown.t) + 90 > width ? 'end' : 'start'}
        >
          {`${formatDb(shown.db)} · ${formatMoment(onTimeline(clip, shown.t))}`}
        </text>
      )}
    </svg>
  );
}

/** The volume line's controls in a sound clip's panel. */
export function GainLinePanel({
  clip,
  playhead,
  selected,
  readOnly,
  onSelect,
  onApply,
}: {
  clip: EditClip;
  playhead: number;
  selected: number | null;
  readOnly: boolean;
  onSelect: (index: number | null) => void;
  /** An undoable change; changes under one key in quick succession are one step. */
  onApply: (key: string, gain: GainPoint[]) => void;
}) {
  if (clip.bed && !clip.gain) {
    return (
      <div className="ve-gain-panel">
        <span className="ve-gain-title">Volume line</span>
        <p className="ve-hint">This music dips under the voice by itself when the edit is exported.</p>
      </div>
    );
  }
  const points = clip.gain ?? [];
  const point = selected !== null ? points[selected] : undefined;
  const len = editClipLength(clip);
  const local = playhead - clip.start;
  const overClip = local >= 0 && local <= len;
  const atPlayhead = clip.in + local * (clip.speed || 1);
  const original = clip.original?.gain;
  const isOriginal = Boolean(original) && JSON.stringify(original) === JSON.stringify(points);
  return (
    <div className="ve-gain-panel">
      <span className="ve-gain-title">
        Volume line · {points.length} key point{points.length === 1 ? '' : 's'}
      </span>
      <p className="ve-hint">
        {clip.bed ? 'The music dips under the voice at these points, as it did in the film. ' : ''}
        Drag a point up or down on the timeline, click the line to add one, double-click a point to remove it.
      </p>
      {point && selected !== null && (
        <label className="ve-field">
          <span>
            Key point at {formatMoment(onTimeline(clip, point.t))} · {formatDb(point.db)}
          </span>
          <input
            type="range"
            min={GAIN_FLOOR_DB}
            max={GAIN_CEILING_DB}
            step={0.5}
            value={point.db}
            disabled={readOnly}
            onChange={(e) => onApply('gain-level', moveGainPoint(points, selected, point.t, Number(e.target.value)))}
          />
        </label>
      )}
      <div className="ve-row">
        <button
          type="button"
          className="ve-btn ghost"
          disabled={readOnly || !overClip}
          title={overClip ? undefined : 'Move the playhead over this clip first'}
          onClick={() => {
            // A point already at the playhead is picked rather than doubled.
            const there = points.findIndex((p) => Math.abs(p.t - atPlayhead) < 0.02);
            if (there >= 0) return onSelect(there);
            const { points: next, index } = addGainPoint(points, atPlayhead);
            if (index < 0) return;
            onApply('gain-add', next);
            onSelect(index);
          }}
        >
          Add point at playhead
        </button>
        <button
          type="button"
          className="ve-btn ghost"
          disabled={readOnly || selected === null || !point}
          onClick={() => {
            if (selected === null) return;
            onApply('gain-remove', removeGainPoint(points, selected));
            onSelect(null);
          }}
        >
          Remove point
        </button>
      </div>
      {original && (
        <button
          type="button"
          className="ve-btn ghost"
          disabled={readOnly || isOriginal}
          onClick={() => {
            onApply('gain-reset', original);
            onSelect(null);
          }}
        >
          Back to automatic
        </button>
      )}
    </div>
  );
}
