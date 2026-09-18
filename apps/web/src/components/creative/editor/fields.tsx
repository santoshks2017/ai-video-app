import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { isCreativeColour } from '@ava/shared';

/**
 * The image editor's form controls. Each reports every change as it happens — the editor
 * folds a run of changes to one field into one step of history — and a typed number or
 * colour is only passed on once it can be read, so a half-typed value never reaches the canvas.
 */

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function Group({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="ce-group">
      <div className="ce-group-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * A number typed in, or stepped with the arrow keys (Shift for ten steps). While it is being
 * typed it passes on each value that is in range; leaving the box puts an out-of-range value
 * back in range, and one that cannot be read back to what it was.
 */
export function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  digits = 0,
  blank,
  suffix,
  disabled,
  wide,
  title,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min: number;
  max: number;
  step?: number;
  /** Places after the point; 0 keeps whole numbers. */
  digits?: number;
  /** Shown when empty: an empty box is allowed and means "none". */
  blank?: string;
  suffix?: string;
  disabled?: boolean;
  /** The label above the box rather than inside it. */
  wide?: boolean;
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const round = (n: number): number => (digits ? Number(n.toFixed(digits)) : Math.round(n));
  const shown = draft ?? (value === undefined || !Number.isFinite(value) ? '' : String(round(value)));
  const read = (s: string): number | undefined | null => {
    const t = s.trim().replace(',', '.');
    if (!t) return blank !== undefined ? undefined : null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  const apply = (s: string, final: boolean): void => {
    const n = read(s);
    if (n === null) return;
    if (n === undefined) {
      if (value !== undefined) onChange(undefined);
      return;
    }
    const kept = round(clamp(n, min, max));
    if (!final && kept !== round(n)) return;
    if (kept !== value) onChange(kept);
  };
  const stepBy = (dir: 1 | -1, big: boolean): void => {
    const base = read(shown) ?? value ?? min;
    const next = round(clamp(base + dir * step * (big ? 10 : 1), min, max));
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      cancelled.current = true;
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      stepBy(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
    }
  };
  return (
    <label className={`ce-num${wide ? ' ce-wide' : ''}${disabled ? ' ce-off' : ''}`} title={title}>
      <span className="ce-num-label">{label}</span>
      <span className="ce-num-box">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={shown}
          placeholder={blank}
          disabled={disabled}
          onFocus={(e) => {
            cancelled.current = false;
            setDraft(e.currentTarget.value);
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            apply(e.target.value, false);
          }}
          onBlur={() => {
            if (draft !== null && !cancelled.current) apply(draft, true);
            cancelled.current = false;
            setDraft(null);
          }}
          onKeyDown={onKey}
        />
        {suffix && <span className="ce-num-suffix">{suffix}</span>}
      </span>
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  return (
    <label className={`ce-slider${disabled ? ' ce-off' : ''}`}>
      <span className="ce-slider-label">
        {label}
        <output>{format ? format(value) : String(value)}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Toggle({ label, checked, onChange, disabled, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <label className={`ce-check${disabled ? ' ce-off' : ''}`} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** An on/off switch for a section's header: its label is read out, not shown. */
export function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`ce-switch${disabled ? ' ce-off' : ''}`} title={`${label}: ${checked ? 'on' : 'off'}`}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="ce-switch-track" aria-hidden="true" />
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; text: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ce-seg-wrap">
      <span className="ce-label">{label}</span>
      <div className="ce-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.value === value ? 'ce-on' : ''}
            aria-pressed={o.value === value}
            title={o.title}
            disabled={disabled}
            onClick={() => o.value !== value && onChange(o.value)}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---- colours ---- */

/** A colour the picker can show — its hex — and the opacity it cannot. Only hex and rgb()/rgba() are read. */
export function parseColour(v: string): { hex: string; alpha: number } | null {
  const s = v.trim().toLowerCase();
  const hexMatch = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hexMatch) {
    let h = hexMatch[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { hex: `#${h.slice(0, 6)}`, alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (rgb) {
    const channel = (t: string): number => {
      const n = parseFloat(t);
      return clamp(Math.round(t.endsWith('%') ? n * 2.55 : n), 0, 255);
    };
    const hex = `#${[rgb[1]!, rgb[2]!, rgb[3]!].map((t) => channel(t).toString(16).padStart(2, '0')).join('')}`;
    return { hex, alpha: rgb[4] === undefined ? 1 : clamp(parseFloat(rgb[4]), 0, 1) };
  }
  return null;
}

/** A picked hex with the opacity the colour had before, which the picker cannot show. */
export function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 0.999) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 1000) / 1000})`;
}

/** A colour the renderer can draw: the app's own check, and one the browser can read. */
export const isDrawableColour = (v: string): boolean => isCreativeColour(v) && parseColour(v) !== null;

export function ColourField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  /** Empty for no colour at all (a shape with no fill). */
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = parseColour(value);
  const bad = draft !== null && !isDrawableColour(draft);
  return (
    <div className={`ce-colour${disabled ? ' ce-off' : ''}`}>
      <span className="ce-label" id={`${id}-l`}>
        {label}
      </span>
      <div className="ce-colour-row">
        <span className="ce-swatch" style={{ '--ce-swatch': value } as CSSProperties}>
          <input
            type="color"
            aria-labelledby={`${id}-l`}
            title="Pick a colour"
            value={parsed?.hex ?? '#000000'}
            disabled={disabled}
            onChange={(e) => onChange(withAlpha(e.target.value, parsed?.alpha ?? 1))}
          />
        </span>
        <input
          type="text"
          className={bad ? 'ce-bad' : ''}
          aria-label={`${label}, as hex or rgba`}
          aria-invalid={bad}
          spellCheck={false}
          autoComplete="off"
          value={draft ?? value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            const v = e.target.value.trim();
            if (isDrawableColour(v) && v !== value) onChange(v);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </div>
    </div>
  );
}
