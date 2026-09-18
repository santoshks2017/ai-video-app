import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import {
  CREATIVE_MAX_LAYERS,
  addLayer,
  duplicateLayer,
  removeLayer,
  reorderLayer,
  updateLayer,
  validateCreativeDoc,
  type CreativeDoc,
  type CreativeLayer,
} from '@ava/shared';
import { filesFrom } from '../ui.js';
import { downloadBlob, exportCreative, fileNameOf, loadImage } from './render.js';
import { CanvasStage, type StageApi } from './editor/CanvasStage.js';
import { boxOf, keepOnFrame } from './editor/geometry.js';
import { Icon } from './editor/icons.js';
import { LayersPanel, type NewLayerKind } from './editor/LayersPanel.js';
import { baseName, newImageLayer, newShapeLayer, newTextLayer, pictureSizeOf, withoutEmptyFields, type PictureSize } from './editor/newLayers.js';
import { PicturePicker } from './editor/PicturePicker.js';
import { PropsPanel, type LayerPatch } from './editor/PropsPanel.js';
import './creativeEditor.css';

/**
 * The image editor: a light Photoshop for one social creative.
 *
 * The layers on the left, the creative in the middle, the selected layer's properties on the
 * right. The creative is drawn by the same renderer as the project's cards and the file that
 * downloads, so what is on the stage is what is saved and exported. Every change is a new
 * document and the one before it is kept, so anything can be undone; a drag, or a run of
 * typing in one field, is one step. A viewer can try every tool, but nothing is saved or
 * uploaded.
 */

export interface EditorPicture {
  label: string;
  src: string;
  storagePath?: string;
}

const VIEWER_NOTE = 'Viewer access — changes are not saved';

/** Keys typed into a field belong to the field, not to the editor. */
const isField = (t: EventTarget | null): t is HTMLElement =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

type PickerState = { mode: 'add' } | { mode: 'replace'; id: string };

export function CreativeEditor({
  doc: opened,
  title,
  readOnly = false,
  library,
  onUpload,
  onSave,
  onClose,
}: {
  doc: CreativeDoc;
  /** Shown in the header, e.g. "Instagram square · Navratri offer". */
  title: string;
  readOnly?: boolean;
  /** Pictures that can be dropped in or swapped in: the project's photos and scenes, the client's logos. */
  library: EditorPicture[];
  /** Upload a picture from the computer; resolves to where it is stored, or null when it failed. Absent in read-only. */
  onUpload?: (file: File) => Promise<{ src: string; storagePath: string } | null>;
  /** Save the edited document (the caller stores it and renders the PNG). */
  onSave: (doc: CreativeDoc) => Promise<void> | void;
  onClose: () => void;
}): JSX.Element {
  // The document is read when the editor opens; open another one by mounting the editor again.
  const [doc, setDoc] = useState<CreativeDoc>(opened);
  const docRef = useRef(doc);
  const [saved, setSaved] = useState<CreativeDoc>(opened);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const dirty = doc !== saved;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [focusText, setFocusText] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<'png' | 'jpg' | null>(null);
  const stageRef = useRef<StageApi>(null);

  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // A passing note clears itself; an error stays until it is read and dismissed.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(''), 2500);
    return () => clearTimeout(t);
  }, [status]);

  /* ---- history: every change is a new document, and the old one is kept ---- */

  const past = useRef<CreativeDoc[]>([]);
  const future = useRef<CreativeDoc[]>([]);
  const [, setHistoryTick] = useState(0);
  const lastEdit = useRef<{ key: string; at: number } | null>(null);

  const live = useCallback((next: CreativeDoc) => {
    docRef.current = next;
    setDoc(next);
  }, []);
  const commit = useCallback((next: CreativeDoc, before: CreativeDoc = docRef.current) => {
    if (next === before) return;
    past.current.push(before);
    if (past.current.length > 200) past.current.shift();
    future.current = [];
    lastEdit.current = null;
    docRef.current = next;
    setDoc(next);
    setHistoryTick((n) => n + 1);
  }, []);
  /** A slider drag or a run of typing in one field is one step of history, not sixty. */
  const edit = useCallback(
    (key: string, next: CreativeDoc) => {
      if (next === docRef.current) return;
      const now = Date.now();
      const last = lastEdit.current;
      if (last && last.key === key && now - last.at < 800) live(next);
      else commit(next);
      lastEdit.current = { key, at: now };
    },
    [commit, live],
  );
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(docRef.current);
    lastEdit.current = null;
    live(prev);
    setHistoryTick((n) => n + 1);
  }, [live]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(docRef.current);
    lastEdit.current = null;
    live(next);
    setHistoryTick((n) => n + 1);
  }, [live]);

  /* ---- layers ---- */

  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;
  const canAdd = doc.layers.length < CREATIVE_MAX_LAYERS;
  const tooMany = `A creative takes up to ${CREATIVE_MAX_LAYERS} layers.`;

  const place = (layer: CreativeLayer): boolean => {
    const d = docRef.current;
    if (d.layers.length >= CREATIVE_MAX_LAYERS) {
      setNotice(tooMany);
      return false;
    }
    commit(addLayer(d, layer));
    setSelectedId(layer.id);
    return true;
  };

  const addNew = (kind: NewLayerKind): void => {
    const d = docRef.current;
    if (kind === 'picture') setPicker({ mode: 'add' });
    // New words are ready to be typed over.
    else if (kind === 'text') {
      if (place(newTextLayer(d))) setFocusText((n) => n + 1);
    } else place(newShapeLayer(d, kind));
  };

  const duplicate = (): void => {
    const d = docRef.current;
    if (!selectedId) return;
    if (d.layers.length >= CREATIVE_MAX_LAYERS) return setNotice(tooMany);
    const r = duplicateLayer(d, selectedId);
    if (!r.id) return;
    // A copy is made to be moved, so it is never locked, whatever the original was.
    commit(updateLayer(r.doc, r.id, { locked: false }));
    setSelectedId(r.id);
  };

  const remove = (): void => {
    const d = docRef.current;
    const l = d.layers.find((x) => x.id === selectedId);
    if (!l) return;
    if (l.locked) return setNotice(`"${l.name}" is locked — unlock it to delete it.`);
    commit(removeLayer(d, l.id));
    setSelectedId(null);
  };

  const nudge = (dx: number, dy: number): void => {
    const d = docRef.current;
    const l = d.layers.find((x) => x.id === selectedId);
    if (!l) return;
    if (l.locked) return setNotice(`"${l.name}" is locked — unlock it to move it.`);
    const at = keepOnFrame({ ...boxOf(l), x: l.x + dx, y: l.y + dy }, d.width, d.height);
    edit(`nudge:${l.id}`, updateLayer(d, l.id, { x: at.x, y: at.y }));
  };

  const change = (patch: LayerPatch, key?: string): void => {
    if (!selectedId) return;
    const next = updateLayer<CreativeLayer>(docRef.current, selectedId, patch);
    if (key) edit(`${key}:${selectedId}`, next);
    else commit(next);
  };

  const toggle = (id: string, field: 'hidden' | 'locked'): void => {
    const d = docRef.current;
    const l = d.layers.find((x) => x.id === id);
    if (l) commit(updateLayer(d, id, field === 'hidden' ? { hidden: !l.hidden } : { locked: !l.locked }));
  };

  /* ---- pictures ---- */

  type Picture = { src: string; storagePath?: string; label: string };
  /** A picture on a new layer, or in place of the one a layer shows — in the same box, framed afresh. */
  const putPicture = (pic: Picture, size: PictureSize | null, replaceId?: string): boolean => {
    const d = docRef.current;
    if (!replaceId) return place(newImageLayer(d, pic, size));
    const l = d.layers.find((x) => x.id === replaceId);
    if (!l || l.kind !== 'image') return false;
    commit(updateLayer(d, replaceId, { src: pic.src, storagePath: pic.storagePath, focusX: 0.5, focusY: 0.5, zoom: 1 }));
    setSelectedId(replaceId);
    return true;
  };

  const pickFromLibrary = async (p: EditorPicture, replaceId?: string): Promise<void> => {
    setPicker(null);
    setBusy('Opening the picture…');
    // Loaded as the renderer loads it: a picture that cannot be drawn is not put on the creative.
    const img = await loadImage(p.src);
    if (!alive.current) return;
    setBusy('');
    if (!img) return setError(`"${p.label}" could not be loaded, so it cannot be drawn on the creative.`);
    putPicture({ src: p.src, storagePath: p.storagePath, label: p.label }, { w: img.naturalWidth, h: img.naturalHeight }, replaceId);
  };

  const uploadBlocked = readOnly ? 'Viewer access — pictures cannot be uploaded' : !onUpload ? 'Uploading is not available here' : null;
  const uploading = useRef(false);
  const uploadPictures = async (files: File[], replaceId?: string): Promise<void> => {
    if (uploadBlocked || !onUpload) return setNotice(uploadBlocked ?? 'Uploading is not available here');
    const pictures = files.filter((f) => f.type.startsWith('image/'));
    if (!pictures.length) return setNotice('Only a picture can be added here.');
    if (uploading.current) return setNotice('A picture is still uploading — add the next one in a moment.');
    uploading.current = true;
    const list = replaceId ? pictures.slice(0, 1) : pictures.slice(0, 10);
    try {
      for (const [i, file] of list.entries()) {
        setBusy(list.length > 1 ? `Uploading ${i + 1} of ${list.length}…` : 'Uploading…');
        const [size, stored] = await Promise.all([
          pictureSizeOf(file),
          Promise.resolve()
            .then(() => onUpload(file))
            .catch(() => null),
        ]);
        if (!alive.current) return;
        if (!stored) {
          setError(`"${file.name}" could not be uploaded.`);
          continue;
        }
        if (!putPicture({ src: stored.src, storagePath: stored.storagePath, label: baseName(file.name) || 'Picture' }, size, replaceId)) break;
      }
    } finally {
      uploading.current = false;
      if (alive.current) setBusy('');
    }
  };

  const pictureError = (src: string): void => {
    const names = docRef.current.layers.filter((l) => l.kind === 'image' && l.src === src).map((l) => `"${l.name}"`);
    setError(`${names.length ? `The picture in ${names.join(', ')}` : 'A picture'} could not be loaded — it shows grey here and would download grey.`);
  };

  /* ---- saving, downloading, closing ---- */

  const savingRef = useRef(false);
  const save = async (): Promise<void> => {
    if (readOnly) return setNotice(VIEWER_NOTE);
    if (savingRef.current) return;
    const d = docRef.current;
    const problem = validateCreativeDoc(d);
    if (problem) {
      setStatus('');
      return setError(problem);
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave(withoutEmptyFields(d));
      if (!alive.current) return;
      setSaved(d);
      setStatus('Saved');
    } catch (err) {
      if (alive.current) setError(err instanceof Error && err.message ? err.message : 'The creative could not be saved — try again.');
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };

  const exportingRef = useRef(false);
  const download = async (type: 'png' | 'jpg'): Promise<void> => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(type);
    setError('');
    try {
      const blob = await exportCreative(docRef.current, type === 'png' ? 'image/png' : 'image/jpeg', 0.92);
      downloadBlob(blob, fileNameOf(title, type));
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof DOMException && err.name === 'SecurityError') setError('A picture on this creative does not allow downloading — replace it and try again.');
      else setError(err instanceof Error && err.message ? err.message : 'The file could not be made.');
    } finally {
      exportingRef.current = false;
      if (alive.current) setExporting(null);
    }
  };

  const requestClose = (): void => {
    if (!readOnly && docRef.current !== savedRef.current && !window.confirm('Close the editor? The changes since the last save will be lost.')) return;
    onClose();
  };

  // Leaving the page with unsaved changes asks first, as closing the editor does.
  useEffect(() => {
    if (!dirty || readOnly) return;
    const warn = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, readOnly]);

  /* ---- the keyboard and the clipboard ---- */

  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    if (e.defaultPrevented) return;
    if (isField(e.target)) {
      // Escape leaves the field, so the next one reaches the editor.
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (picker) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPicker(null);
      }
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (selectedId) setSelectedId(null);
      else requestClose();
      return;
    }
    if (mod && key === 's') {
      e.preventDefault();
      void save();
      return;
    }
    if (stageRef.current?.dragging()) return;
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      redo();
    } else if (mod && key === 'd') {
      e.preventDefault();
      duplicate();
    } else if (!mod && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) {
      if (!selectedId) return;
      e.preventDefault();
      remove();
    } else if (!mod && !e.altKey && e.key.startsWith('Arrow') && selectedId) {
      const step = e.shiftKey ? 10 : 1;
      e.preventDefault();
      if (e.key === 'ArrowLeft') nudge(-step, 0);
      else if (e.key === 'ArrowRight') nudge(step, 0);
      else if (e.key === 'ArrowUp') nudge(0, -step);
      else if (e.key === 'ArrowDown') nudge(0, step);
    }
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent): void => onKey.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // A picture on the clipboard, pasted anywhere but in a field, is uploaded and added.
  const onPaste = useRef<(files: File[]) => void>(() => {});
  onPaste.current = (files) => {
    const p = picker;
    if (p) setPicker(null);
    void uploadPictures(files, p?.mode === 'replace' ? p.id : undefined);
  };
  useEffect(() => {
    const listener = (e: ClipboardEvent): void => {
      if (isField(e.target)) return;
      const files = filesFrom(e.clipboardData, 'image/*');
      if (!files.length) return;
      e.preventDefault();
      onPaste.current(files);
    };
    window.addEventListener('paste', listener);
    return () => window.removeEventListener('paste', listener);
  }, []);

  // The keyboard works from the start, and a screen reader starts inside the editor.
  useEffect(() => {
    stageRef.current?.focus();
  }, []);

  /* ---- render ---- */

  const pct = Math.round(zoom * 100);
  const editText = (id: string): void => {
    setSelectedId(id);
    setFocusText((n) => n + 1);
  };

  return createPortal(
    <div
      className="ce-wrap"
      role="dialog"
      aria-modal="true"
      aria-label={`Image editor: ${title}`}
      onDragOver={(e) => {
        // A file let go anywhere but the stage must not open in the tab in place of the app.
        if (e.defaultPrevented || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'none';
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
    >
      <header className="ce-head">
        <div className="ce-title">
          <span className="ce-eyebrow">Image editor</span>
          <h2 title={title}>
            <span className="ce-title-text">{title}</span>
            {dirty && !readOnly && <span className="ce-dot" role="img" aria-label="Unsaved changes" title="Unsaved changes" />}
          </h2>
        </div>
        <div className="ce-status" aria-live="polite">
          {readOnly && <span className="ce-note">{VIEWER_NOTE}</span>}
          {busy && <span className="ce-busy">{busy}</span>}
          {notice && <span className="ce-notice">{notice}</span>}
          {status && <span className="ce-saved">{status}</span>}
          {error && (
            <button type="button" className="ce-error" role="alert" title="Dismiss" onClick={() => setError('')}>
              {error}
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
        <div className="ce-tools">
          <div className="ce-toolset" role="group" aria-label="History">
            <button type="button" className="ce-icon" aria-label="Undo" title="Undo (⌘Z)" disabled={!past.current.length} onClick={undo}>
              <Icon name="undo" />
            </button>
            <button type="button" className="ce-icon" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!future.current.length} onClick={redo}>
              <Icon name="redo" />
            </button>
          </div>
          <span className="ce-sep" />
          <div className="ce-toolset" role="group" aria-label="Zoom">
            <button type="button" className="ce-icon" aria-label="Zoom out" title="Zoom out" onClick={() => stageRef.current?.zoomOut()}>
              <Icon name="zoomOut" />
            </button>
            <button type="button" className="ce-zoom" aria-label={`Zoom ${pct}%. Show at 100%`} title="Show at 100%" onClick={() => stageRef.current?.actualSize()}>
              {pct}%
            </button>
            <button type="button" className="ce-icon" aria-label="Zoom in" title="Zoom in (Ctrl or ⌘ with the wheel zooms about the pointer)" onClick={() => stageRef.current?.zoomIn()}>
              <Icon name="zoomIn" />
            </button>
            <button type="button" className="ce-btn ce-ghost ce-sm" title="Fit the frame to the stage" onClick={() => stageRef.current?.fit()}>
              Fit
            </button>
          </div>
          <span className="ce-sep" />
          <button type="button" className="ce-btn ce-sm" disabled={Boolean(exporting)} onClick={() => void download('png')}>
            <Icon name="download" size={15} />
            {exporting === 'png' ? 'Preparing…' : <span className="ce-long">Download PNG</span>}
            {exporting !== 'png' && <span className="ce-short">PNG</span>}
          </button>
          <button type="button" className="ce-btn ce-sm" disabled={Boolean(exporting)} onClick={() => void download('jpg')}>
            <Icon name="download" size={15} />
            {exporting === 'jpg' ? 'Preparing…' : <span className="ce-long">Download JPG</span>}
            {exporting !== 'jpg' && <span className="ce-short">JPG</span>}
          </button>
          <button
            type="button"
            className="ce-btn ce-primary"
            disabled={readOnly || saving}
            title={readOnly ? VIEWER_NOTE : 'Save (⌘S)'}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="ce-btn ce-ghost" onClick={requestClose}>
            Close
          </button>
        </div>
      </header>

      <div className="ce-body">
        <LayersPanel
          layers={doc.layers}
          selectedId={selectedId}
          canAdd={canAdd}
          onSelect={setSelectedId}
          onToggle={toggle}
          onRename={(id, name) => commit(updateLayer(docRef.current, id, { name }))}
          onReorder={(id, to) => commit(reorderLayer(docRef.current, id, to))}
          onAdd={addNew}
          onDuplicate={duplicate}
          onDelete={remove}
        />
        <CanvasStage
          ref={stageRef}
          doc={doc}
          getDoc={() => docRef.current}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onLive={live}
          onCommit={commit}
          onEditText={editText}
          onFiles={(files) => void uploadPictures(files)}
          onZoom={setZoom}
          onPictureError={pictureError}
        />
        <PropsPanel
          doc={doc}
          layer={selected}
          onChange={change}
          onBackground={(background) => edit('background', { ...docRef.current, background })}
          onArrange={(to) => selectedId && commit(reorderLayer(docRef.current, selectedId, to))}
          onReplacePicture={() => selectedId && setPicker({ mode: 'replace', id: selectedId })}
          onDownload={(type) => void download(type)}
          exporting={exporting}
          focusText={focusText}
        />
      </div>

      {picker && (
        <PicturePicker
          mode={picker.mode}
          library={library}
          uploadBlocked={uploadBlocked}
          onPick={(p) => void pickFromLibrary(p, picker.mode === 'replace' ? picker.id : undefined)}
          onFile={(file) => {
            setPicker(null);
            void uploadPictures([file], picker.mode === 'replace' ? picker.id : undefined);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>,
    document.body,
  );
}
