import { useRef, useState, type ReactNode } from 'react';
import { isApiError, uploadRef } from '../lib/client.js';
import type { StoredImage } from '@ava/shared';

export function Field({
  label,
  hint,
  children,
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Panel({
  title,
  step,
  actions,
  children,
}: {
  title: string;
  step?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="head">
        <h2>{title}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {step && <span className="step">{step}</span>}
          {actions}
        </div>
      </div>
      <div className="body">{children}</div>
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

/** Upload one image and hand back the stored handle. */
export function ImageUpload({
  label,
  kind = 'dealer',
  onUploaded,
  buttonText = 'Upload image',
}: {
  label: string;
  kind?: string;
  onUploaded: (img: StoredImage) => void;
  buttonText?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr('');
    const r = await uploadRef(file, label, kind);
    setBusy(false);
    if (isApiError(r)) {
      setErr(r.message);
      return;
    }
    onUploaded(r as StoredImage);
    if (ref.current) ref.current.value = '';
  };

  return (
    <>
      <button className="btn small" type="button" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? 'Uploading…' : buttonText}
      </button>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
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
