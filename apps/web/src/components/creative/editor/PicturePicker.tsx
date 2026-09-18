import { useEffect, useRef } from 'react';
import { Icon } from './icons.js';

export interface PickerPicture {
  label: string;
  src: string;
  storagePath?: string;
}

/**
 * The pictures a creative can take: the project's photos and scenes and the client's logos,
 * or one from the computer. Opened to add a picture, or to swap the one a layer shows.
 */
export function PicturePicker({
  mode,
  library,
  uploadBlocked,
  onPick,
  onFile,
  onClose,
}: {
  mode: 'add' | 'replace';
  library: PickerPicture[];
  /** Why a picture cannot come from the computer here, or null when it can. */
  uploadBlocked: string | null;
  onPick: (p: PickerPicture) => void;
  onFile: (file: File) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  // The focus starts on the first picture and goes back to whatever opened the picker.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.querySelector<HTMLElement>('.ce-pic, .ce-btn')?.focus();
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="ce-modal-wrap"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ce-modal ce-picker"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'replace' ? 'Replace the picture' : 'Add a picture'}
        ref={box}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="ce-modal-head">
          <h3>{mode === 'replace' ? 'Replace the picture' : 'Add a picture'}</h3>
          <button type="button" className="ce-icon" aria-label="Close" title="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="ce-pic-grid">
          {library.map((p) => (
            <button key={`${p.src}|${p.label}`} type="button" className="ce-pic" title={p.label} onClick={() => onPick(p)}>
              <img src={p.src} alt="" loading="lazy" draggable={false} />
              <span>{p.label}</span>
            </button>
          ))}
          {!library.length && <div className="ce-empty">No pictures in this project yet.</div>}
        </div>
        <div className="ce-modal-foot">
          <button type="button" className="ce-btn" disabled={Boolean(uploadBlocked)} onClick={() => file.current?.click()}>
            From your computer…
          </button>
          {uploadBlocked && <span className="ce-note">{uploadBlocked}</span>}
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onFile(f);
            }}
          />
        </div>
      </div>
    </div>
  );
}
