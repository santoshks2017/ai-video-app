import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isApiError, uploadRef } from '../lib/client.js';
import type { StoredImage } from '@ava/shared';

/**
 * The explanation, out of the way until it is wanted.
 *
 * Every field here had a sentence under it saying what it does. Read once, they
 * are useful; read for the hundredth time they are the reason a brief runs three
 * screens and the storyboard is below the fold. So the sentence moves behind a
 * mark you hover — still one glance away, no longer taking a line each.
 *
 * Hover and keyboard focus both open it and nothing has to close it: leaving with
 * the mouse or the tab key is enough, which is the behaviour to want for something
 * you open by accident a hundred times a day.
 */
export function Info({
  children,
  wide,
  /** Off inside a section header, where the mark sits within a button and may not take focus. */
  focusable = true,
}: {
  children: ReactNode;
  wide?: boolean;
  focusable?: boolean;
}) {
  const [box, setBox] = useState<{ top: number; left: number; width: number; below: boolean } | null>(null);
  const mark = useRef<HTMLSpanElement>(null);

  /*
   * Measured against the window and drawn on the body.
   *
   * Drawn where it sits, the note was clipped by whatever card or section it was
   * inside — every one of them rounds its corners and hides the overflow, so a
   * note on the last field of a panel showed two words and a straight edge. On the
   * body it is bounded by the window instead, and the window is the one box that
   * cannot be smaller than what has to be read.
   */
  const place = (): void => {
    const r = mark.current?.getBoundingClientRect();
    if (!r) return;
    const GAP = 7;
    const EDGE = 10;
    const width = Math.min(wide ? 380 : 280, window.innerWidth - EDGE * 2);
    // Above by default; below when there is less room above than the tallest a
    // note gets — six or seven lines of it, near enough.
    const below = r.top < 180;
    setBox({
      top: below ? r.bottom + GAP : r.top - GAP,
      left: Math.max(EDGE, Math.min(r.left - 6, window.innerWidth - width - EDGE)),
      width,
      below,
    });
  };

  useEffect(() => {
    if (!box) return;
    // A note is read where it was opened: if the page moves under it, it is gone.
    const close = (): void => setBox(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [box]);

  if (!children) return null;
  return (
    <span
      ref={mark}
      className={`info${wide ? ' wide' : ''}`}
      tabIndex={focusable ? 0 : undefined}
      role="note"
      onMouseEnter={place}
      onMouseLeave={() => setBox(null)}
      onFocus={place}
      onBlur={() => setBox(null)}
    >
      <span className="info-mark" aria-hidden>
        i
      </span>
      {box &&
        createPortal(
          <span
            className={`info-pop${box.below ? ' below' : ''}`}
            style={{ top: box.top, left: box.left, width: box.width }}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {(label || hint) && (
        <label>
          {label}
          <Info>{hint}</Info>
        </label>
      )}
      {children}
    </div>
  );
}

export function Panel({
  num,
  title,
  step,
  note,
  actions,
  children,
}: {
  /** The step's place in the sequence, shown as a scene slate. */
  num?: string;
  title: string;
  step?: string;
  /** What this panel is for. Behind the mark, not spread across the top of it. */
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="head">
        <div className="head-left">
          {num && <span className="slate">{num}</span>}
          <h2>{title}</h2>
          <Info wide>{note}</Info>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {step && <span className="step">{step}</span>}
          {actions}
        </div>
      </div>
      <div className="body">{children}</div>
    </div>
  );
}

/**
 * A panel that folds away.
 *
 * Same chrome as a Panel, so a section that is optional does not look like a
 * lesser kind of thing — it is the same card, closed. Pass `open`/`onOpenChange`
 * to drive it from outside (a use case opening as it is picked); leave them out
 * and it keeps its own state.
 */
export function Section({
  num,
  title,
  step,
  need,
  note,
  sub,
  defaultOpen = false,
  open,
  onOpenChange,
  children,
}: {
  num?: string;
  title: string;
  step?: string;
  /** A short count of what is still missing, shown instead of `step`. */
  need?: string;
  /** What this section is for. Behind the mark, not spread across the top of it. */
  note?: ReactNode;
  /** Nested inside another section — quieter chrome. */
  sub?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [selfOpen, setSelfOpen] = useState(defaultOpen);
  const isOpen = open ?? selfOpen;
  const bodyId = useId();
  const toggle = () => {
    setSelfOpen(!isOpen);
    onOpenChange?.(!isOpen);
  };
  return (
    <div className={`sec${isOpen ? ' open' : ''}${sub ? ' sub' : ''}`}>
      <button
        type="button"
        className="sec-head"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={toggle}
      >
        <span className="sec-caret" aria-hidden>
          ▶
        </span>
        {num && <span className="slate">{num}</span>}
        <h2>{title}</h2>
        {note && (
          <span onClick={(e) => e.stopPropagation()}>
            <Info wide focusable={false}>
              {note}
            </Info>
          </span>
        )}
        {need ? <span className="sec-need">{need}</span> : step ? <span className="sec-step">{step}</span> : null}
      </button>
      {isOpen && (
        <div className="sec-body" id={bodyId}>
          {children}
        </div>
      )}
    </div>
  );
}

export function Empty({ icon = '📦', children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="prompt-empty">
      <span className="big">{icon}</span>
      {children}
    </div>
  );
}

export function Banner({ kind, children }: { kind: 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  return (
    <div className={`check ${kind}`} style={{ marginBottom: 10 }}>
      <span className="icon">{kind === 'ok' ? '✓' : kind === 'warn' ? '!' : '✕'}</span>
      <span>{children}</span>
    </div>
  );
}

/** Master/detail list column. */
export function PickList<T extends { id: string }>({
  items,
  activeId,
  onPick,
  render,
  emptyText,
}: {
  items: T[];
  activeId: string | null;
  onPick: (id: string) => void;
  render: (item: T) => ReactNode;
  emptyText: string;
}) {
  if (!items.length) return <div className="hint">{emptyText}</div>;
  return (
    <div className="picklist">
      {items.map((it) => (
        <button
          key={it.id}
          className={`pick${it.id === activeId ? ' on' : ''}`}
          onClick={() => onPick(it.id)}
          type="button"
        >
          {render(it)}
        </button>
      ))}
    </div>
  );
}

/** Does a file fit an `accept` list such as "image/*" or "video/*,image/*"? */
function accepts(accept: string, file: File): boolean {
  return accept
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .some((a) => (a.endsWith('/*') ? file.type.startsWith(a.slice(0, -1)) : file.type === a));
}

/** The files on a clipboard. A copied screenshot arrives as an item rather than in `files`. */
export function filesFrom(data: DataTransfer | null, accept: string): File[] {
  if (!data) return [];
  const direct = [...data.files].filter((f) => accepts(accept, f));
  if (direct.length) return direct;
  return [...data.items]
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter((f): f is File => f !== null && accepts(accept, f));
}

export const PASTE_KEYS = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Ctrl+V';

/**
 * Upload an image — or paste one.
 *
 * A logo or a showroom photo is as often a screenshot on the clipboard as a file on
 * disk, and saving it only to pick it again is two steps for nothing. So the control
 * takes focus when it is clicked, and a paste while it has focus uploads the image on
 * the clipboard exactly as if it had been picked.
 */
export function ImageUpload({
  label,
  kind = 'dealer',
  onUploaded,
  buttonText = 'Upload image',
  multiple = false,
  accept = 'image/*',
}: {
  label: string;
  kind?: string;
  onUploaded: (img: StoredImage) => void;
  buttonText?: string;
  /** Take a whole set in one go — the four angles of a car, say. */
  multiple?: boolean;
  /** What the picker offers. Reference videos pass `video/*`. */
  accept?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [armed, setArmed] = useState(false);
  const what = accept.startsWith('video') ? 'video' : 'image';

  const upload = async (list: File[]) => {
    if (!list.length) return;
    setErr('');
    for (const [i, file] of list.entries()) {
      setBusy(list.length > 1 ? `Uploading ${i + 1} of ${list.length}…` : 'Uploading…');
      const r = await uploadRef(file, list.length > 1 ? `${label} ${i + 1}` : label, kind);
      if (isApiError(r)) {
        setErr(r.message);
        break;
      }
      onUploaded(r as StoredImage);
    }
    setBusy('');
    if (ref.current) ref.current.value = '';
  };

  return (
    <>
      <div
        className={`upload-zone${armed ? ' armed' : ''}`}
        tabIndex={0}
        role="group"
        aria-label={`${buttonText}, or paste ${what === 'video' ? 'a video' : 'an image'}`}
        title={`Click here, then paste ${what === 'video' ? 'a video' : 'an image'} (${PASTE_KEYS})`}
        onFocus={() => setArmed(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArmed(false);
        }}
        onPaste={(e) => {
          const files = filesFrom(e.clipboardData, accept);
          if (!files.length) {
            setErr(`There is no ${what} on the clipboard to paste.`);
            return;
          }
          e.preventDefault();
          if (!busy) void upload(multiple ? files : files.slice(0, 1));
        }}
      >
        <button className="btn small" type="button" disabled={Boolean(busy)} onClick={() => ref.current?.click()}>
          {busy || buttonText}
        </button>
        <span className="upload-paste">{armed ? `Paste now · ${PASTE_KEYS}` : 'or paste'}</span>
        <input
          ref={ref}
          type="file"
          accept={accept}
          multiple={multiple}
          hidden
          onChange={(e) => void upload([...(e.target.files ?? [])])}
        />
      </div>
      {err && <div className="hint" style={{ color: 'var(--bad)' }}>{err}</div>}
    </>
  );
}

export function Thumb({ img, onRemove }: { img: StoredImage; onRemove?: () => void }) {
  return (
    <div className="thumb">
      {img.url ? <img src={img.url} alt={img.label} /> : <div className="thumb-ph">?</div>}
      <span title={img.label}>{img.label}</span>
      {onRemove && (
        <button className="thumb-x" type="button" onClick={onRemove} aria-label="Remove">
          ×
        </button>
      )}
    </div>
  );
}

export function Confirm({ onConfirm, children }: { onConfirm: () => void; children: ReactNode }) {
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <button className="btn ghost small" type="button" onClick={() => setArmed(true)}>
        {children}
      </button>
    );
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button className="btn small" type="button" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }} onClick={onConfirm}>
        Confirm
      </button>
      <button className="btn ghost small" type="button" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

/** Progressive disclosure — keeps the primary path short. */
export function Collapse({
  title,
  hint,
  open = false,
  children,
}: {
  title: string;
  hint?: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="collapse" open={open}>
      <summary>
        <span className="collapse-title">{title}</span>
        {hint && <span className="collapse-hint">{hint}</span>}
      </summary>
      <div className="collapse-body">{children}</div>
    </details>
  );
}

/**
 * A menu that opens over the page.
 *
 * It is drawn into the body rather than inside the field, for two reasons: a
 * dropdown that pushes the form down moves what you were about to click, and a
 * menu inside a column that scrolls gets cut off at the column's edge. Clicking
 * anywhere else closes it, as does Escape, as does scrolling the page under it.
 */
export function Dropdown({
  label,
  title,
  children,
  minWidth = 260,
}: {
  /** What the closed field shows. */
  label: ReactNode;
  title?: string;
  children: ReactNode;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, minWidth);
    setBox({
      top: r.bottom + 4,
      // Never off the right edge of the window.
      left: Math.min(r.left, window.innerWidth - width - 8),
      width,
    });
  };

  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // A fixed menu would drift away from its field, so it follows on scroll —
    // and gives up only once the field itself has left the window. (Closing on
    // any scroll shut it the instant focus scrolled the field into view.)
    const follow = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      place();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        title={title}
        className={`dropdown-btn${open ? ' on' : ''}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dropdown-label">{label}</span>
        <span className="dropdown-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        box &&
        createPortal(
          <div className="dropdown-pop" ref={pop} style={{ top: box.top, left: box.left, width: box.width }}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
