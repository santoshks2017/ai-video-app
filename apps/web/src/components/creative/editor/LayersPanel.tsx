import { useEffect, useRef, useState } from 'react';
import type { CreativeLayer } from '@ava/shared';
import { Icon, type IconName } from './icons.js';

export type NewLayerKind = 'text' | 'rect' | 'ellipse' | 'line' | 'picture';

const glyphOf = (l: CreativeLayer): IconName =>
  l.kind === 'text' ? 'text' : l.kind === 'image' ? 'picture' : l.shape === 'ellipse' ? 'ellipse' : l.shape === 'line' ? 'line' : 'rect';
const kindName = (l: CreativeLayer): string =>
  l.kind === 'text' ? 'Text' : l.kind === 'image' ? 'Picture' : l.shape === 'ellipse' ? 'Ellipse' : l.shape === 'line' ? 'Line' : 'Rectangle';

const ADD: Array<{ kind: NewLayerKind; icon: IconName; label: string; title: string }> = [
  { kind: 'text', icon: 'text', label: 'Text', title: 'Add text' },
  { kind: 'rect', icon: 'rect', label: 'Box', title: 'Add a rectangle' },
  { kind: 'ellipse', icon: 'ellipse', label: 'Oval', title: 'Add an ellipse' },
  { kind: 'line', icon: 'line', label: 'Line', title: 'Add a line' },
  { kind: 'picture', icon: 'picture', label: 'Picture', title: 'Add a picture' },
];

/**
 * The stack, top first, as every layered editor shows it. A row selects its layer — locked
 * ones too, for their properties — and its name is renamed by double-clicking it.
 */
export function LayersPanel({
  layers,
  selectedId,
  canAdd,
  onSelect,
  onToggle,
  onRename,
  onReorder,
  onAdd,
  onDuplicate,
  onDelete,
}: {
  layers: CreativeLayer[];
  selectedId: string | null;
  canAdd: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, field: 'hidden' | 'locked') => void;
  onRename: (id: string, name: string) => void;
  onReorder: (id: string, to: 'up' | 'down') => void;
  onAdd: (kind: NewLayerKind) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [renaming, setRenamingState] = useState<{ id: string; name: string } | null>(null);
  // Held in a ref too: Enter ends a rename and removes the box, and a browser may then send it a blur as well.
  const renamingRef = useRef<{ id: string; name: string } | null>(null);
  const setRenaming = (r: { id: string; name: string } | null): void => {
    renamingRef.current = r;
    setRenamingState(r);
  };
  const refocus = useRef<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const top = layers.length - 1;
  const selected = layers.find((l) => l.id === selectedId) ?? null;
  const rowButton = (id: string): HTMLElement | null =>
    listRef.current?.querySelector<HTMLElement>(`[data-layer="${CSS.escape(id)}"] .ce-layer-main`) ?? null;

  // A layer picked on the canvas is brought into view in the list.
  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-layer="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  // A rename ended from the keyboard gives the focus back to its row.
  useEffect(() => {
    if (renaming || !refocus.current) return;
    rowButton(refocus.current)?.focus();
    refocus.current = null;
  }, [renaming]);

  const finishRename = (keep: boolean, fromKeyboard = false): void => {
    const r = renamingRef.current;
    if (!r) return;
    setRenaming(null);
    if (fromKeyboard) refocus.current = r.id;
    if (!keep) return;
    const name = r.name.trim().slice(0, 80);
    const was = layers.find((l) => l.id === r.id)?.name;
    if (name && name !== was) onRename(r.id, name);
  };

  return (
    <aside className="ce-panel ce-layers" aria-label="Layers">
      <div className="ce-panel-head">
        <h3>Layers</h3>
        <span className="ce-count">{layers.length}</span>
      </div>
      <ol className="ce-layer-list" ref={listRef}>
        {[...layers].reverse().map((l, i) => {
          const index = top - i;
          const on = l.id === selectedId;
          return (
            <li key={l.id} data-layer={l.id} className={`ce-layer${on ? ' ce-on' : ''}${l.hidden ? ' ce-dim' : ''}`}>
              {renaming?.id === l.id ? (
                <input
                  type="text"
                  className="ce-rename"
                  aria-label={`Rename ${l.name}`}
                  value={renaming.name}
                  maxLength={80}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setRenaming({ id: l.id, name: e.target.value })}
                  onBlur={() => finishRename(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finishRename(true, true);
                    else if (e.key === 'Escape') {
                      e.stopPropagation();
                      finishRename(false, true);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="ce-layer-main"
                  aria-current={on ? 'true' : undefined}
                  title={`${kindName(l)} · double-click to rename`}
                  onClick={() => onSelect(l.id)}
                  onDoubleClick={() => setRenaming({ id: l.id, name: l.name })}
                  onKeyDown={(e) => {
                    if (e.key === 'F2') {
                      e.preventDefault();
                      setRenaming({ id: l.id, name: l.name });
                    }
                  }}
                >
                  <span className="ce-layer-glyph">
                    <Icon name={glyphOf(l)} size={15} />
                  </span>
                  <span className="ce-layer-name">{l.name || kindName(l)}</span>
                </button>
              )}
              <span className="ce-layer-tools">
                <button type="button" className="ce-mini ce-order" aria-label={`Move ${l.name} up`} title="Up the stack" disabled={index === top} onClick={() => onReorder(l.id, 'up')}>
                  <Icon name="up" size={14} />
                </button>
                <button type="button" className="ce-mini ce-order" aria-label={`Move ${l.name} down`} title="Down the stack" disabled={index === 0} onClick={() => onReorder(l.id, 'down')}>
                  <Icon name="down" size={14} />
                </button>
                <button
                  type="button"
                  className={`ce-mini${l.hidden ? ' ce-off' : ''}`}
                  aria-pressed={Boolean(l.hidden)}
                  aria-label={l.hidden ? `Show ${l.name}` : `Hide ${l.name}`}
                  title={l.hidden ? 'Hidden — show it' : 'Hide'}
                  onClick={() => onToggle(l.id, 'hidden')}
                >
                  <Icon name={l.hidden ? 'eyeOff' : 'eye'} size={15} />
                </button>
                <button
                  type="button"
                  className={`ce-mini${l.locked ? ' ce-lit' : ''}`}
                  aria-pressed={Boolean(l.locked)}
                  aria-label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`}
                  title={l.locked ? 'Locked — it cannot be moved on the canvas. Unlock' : 'Lock in place'}
                  onClick={() => onToggle(l.id, 'locked')}
                >
                  <Icon name={l.locked ? 'lock' : 'unlock'} size={15} />
                </button>
              </span>
            </li>
          );
        })}
        {!layers.length && <li className="ce-empty">No layers yet — add text, a shape or a picture below.</li>}
      </ol>
      <div className="ce-layer-foot">
        <div className="ce-add" role="group" aria-label="Add a layer">
          {ADD.map((a) => (
            <button key={a.kind} type="button" className="ce-add-btn" title={a.title} aria-label={a.title} disabled={!canAdd} onClick={() => onAdd(a.kind)}>
              <Icon name={a.icon} size={16} />
              <span>{a.label}</span>
            </button>
          ))}
        </div>
        <div className="ce-row">
          <button type="button" className="ce-btn ce-sm" disabled={!selected || !canAdd} onClick={onDuplicate} title="Duplicate (⌘D)">
            <Icon name="dup" size={15} />
            Duplicate
          </button>
          <button
            type="button"
            className="ce-btn ce-sm ce-danger"
            disabled={!selected || Boolean(selected.locked)}
            onClick={onDelete}
            title={selected?.locked ? 'Unlock the layer to delete it' : 'Delete (⌫)'}
          >
            <Icon name="del" size={15} />
            Delete
          </button>
        </div>
      </div>
    </aside>
  );
}
