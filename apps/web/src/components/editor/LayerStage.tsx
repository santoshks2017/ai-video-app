import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  EDIT_MAIN_TRACK,
  editCaptionSpots,
  editClipEnd,
  editLayerGuides,
  editSnapBox,
  isLightColour,
  type EditClip,
  type EditLook,
  type EditPlacement,
  type EditProject,
} from '@ava/shared';
import { refUrl } from '../../lib/api.js';
import type { LayerImage } from './useLayerImages.js';

/** Captions under logos, logos under the footer — the order the film draws them in. */
const PAINT: Record<string, number> = { caption: 0, logo: 1, footer: 2 };

interface Props {
  project: EditProject;
  look: EditLook;
  viewTime: number;
  stageW: number;
  stageH: number;
  selectedId: string | null;
  images: Map<string, LayerImage>;
  fadeOpacity: (c: EditClip, t: number) => number;
  readOnly: boolean;
  onSelect: (id: string) => void;
  /** A layer was taken hold of: the film stops, as it does for a drag on the timeline. */
  onGrab: () => void;
  /** A drag in progress: shown, not yet a step of history. */
  onMove: (id: string, place: EditPlacement) => void;
  /** A drag finished: one step of history, from the edit as it was when the drag began. */
  onCommit: (before: EditProject) => void;
  onNudge: (id: string, place: EditPlacement) => void;
  /** Double-click on a caption: its words, ready to type. */
  onEditText: (id: string) => void;
}

interface Drag {
  id: string;
  pointerId: number;
  mode: 'move' | 'scale';
  before: EditProject;
  x0: number;
  y0: number;
  place: EditPlacement;
  w: number;
  h: number;
  moved: boolean;
}

/**
 * The film's layers over the preview. Each is the picture the export will draw, placed
 * where the export will place it; click one to select it, drag it to move it, drag its
 * corner to resize it, and use the arrow keys to nudge it.
 */
export function LayerStage(props: Props) {
  const { project, look, viewTime, stageW, stageH, selectedId, images } = props;
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [caught, setCaught] = useState<{ x?: number; y?: number }>({});

  const hidden = new Set(project.tracks.filter((t) => t.hidden).map((t) => t.id));
  const endCardStart = project.clips.find((c) => c.trackId === EDIT_MAIN_TRACK && c.layer?.kind === 'endcard')?.start;
  const shown = project.clips
    .filter((c) => c.layer && c.layer.kind !== 'endcard' && c.place && !hidden.has(c.trackId) && viewTime >= c.start && viewTime < editClipEnd(c))
    .sort((a, b) => (PAINT[a.layer!.kind] ?? 0) - (PAINT[b.layer!.kind] ?? 0));

  /**
   * A layer's size as fractions of the frame. A caption's picture is redrawn at a new size a
   * moment after resizing stops; until then its last picture is shown stretched to the size
   * it is being dragged to, so resizing follows the pointer.
   */
  const sizeOf = (c: EditClip): { w: number; h: number } => {
    const img = images.get(c.id);
    const k = img && c.place ? c.place.scale / img.scale : 1;
    return c.layer?.kind === 'footer'
      ? { w: 1, h: (img?.height ?? 0) / look.height }
      : { w: ((img?.width ?? 0) * k) / look.width, h: ((img?.height ?? 0) * k) / look.height };
  };
  /** Somewhere a layer can still be seen and grabbed: at least a sliver of it stays on the frame. */
  const onFrame = (x: number, y: number, s: { w: number; h: number }): { x: number; y: number } => ({
    x: Math.max(0.02 - s.w, Math.min(0.98, x)),
    y: Math.max(0.02 - s.h, Math.min(0.98, y)),
  });
  const darkCard = !isLightColour(look.colours.card);

  const begin = (e: ReactPointerEvent<HTMLElement>, c: EditClip, mode: Drag['mode']): void => {
    e.stopPropagation();
    // Held for the arrow keys, without scrolling a narrow editor out from under the pointer.
    box.current?.focus({ preventScroll: true });
    props.onSelect(c.id);
    if (props.readOnly) return;
    props.onGrab();
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = sizeOf(c);
    drag.current = { id: c.id, pointerId: e.pointerId, mode, before: project, x0: e.clientX, y0: e.clientY, place: c.place!, w: s.w, h: s.h, moved: false };
  };

  const move = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId || !stageW || !stageH) return;
    // The button came up somewhere this box never heard about: the drag is over.
    if (e.buttons === 0) return end();
    if (!d.moved && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 3) return;
    d.moved = true;
    const dx = (e.clientX - d.x0) / stageW;
    const dy = (e.clientY - d.y0) / stageH;
    const clip = project.clips.find((c) => c.id === d.id);
    if (!clip) return;
    if (d.mode === 'scale') {
      props.onMove(d.id, { ...d.place, scale: Math.max(0.5, Math.min(2, d.place.scale * (1 + dx / Math.max(0.05, d.w)))) });
      return;
    }
    const footer = clip.layer?.kind === 'footer';
    let x = footer ? 0 : d.place.x + dx;
    let y = d.place.y + dy;
    if (e.altKey) {
      setCaught({});
    } else {
      const snapped = editSnapBox({ x, y }, { w: d.w, h: d.h }, editLayerGuides(look), { x: 8 / stageW, y: 8 / stageH });
      x = footer ? 0 : snapped.x;
      y = snapped.y;
      setCaught(footer ? { y: snapped.caught.y } : snapped.caught);
      if (clip.layer?.kind === 'caption') {
        const footerClip = project.clips.find((c) => c.layer?.kind === 'footer');
        const footerH = footerClip ? (images.get(footerClip.id)?.height ?? 0) : 0;
        const spot = editCaptionSpots(look, { w: d.w * look.width, h: d.h * look.height }, footerH).find(
          (s) => Math.abs(s.x - x) * stageW < 12 && Math.abs(s.y - y) * stageH < 12,
        );
        if (spot) {
          x = spot.x;
          y = spot.y;
        }
      }
    }
    const kept = onFrame(x, y, d);
    props.onMove(d.id, { ...d.place, x: footer ? 0 : kept.x, y: kept.y });
  };

  const end = (): void => {
    const d = drag.current;
    drag.current = null;
    setCaught({});
    if (d?.moved) props.onCommit(d.before);
  };

  const nudge = (e: KeyboardEvent<HTMLDivElement>): void => {
    const c = project.clips.find((x) => x.id === selectedId && x.layer && x.place);
    const step = e.shiftKey ? 0.05 : 0.005;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
    if (!c || !d || props.readOnly) return;
    e.preventDefault();
    const kept = onFrame(c.place!.x + d[0], c.place!.y + d[1], sizeOf(c));
    props.onNudge(c.id, { ...c.place!, x: c.layer!.kind === 'footer' ? 0 : kept.x, y: kept.y });
  };

  return (
    <div className="ve-layers" ref={box} tabIndex={-1} onKeyDown={nudge}>
      {shown.map((c) => {
        const img = images.get(c.id);
        if (!img) return null;
        const layer = c.layer!;
        // White on a dark end card only, as the export draws it.
        const white =
          layer.kind === 'logo' && layer.whiteOnEndCard && layer.whitePath && darkCard && endCardStart !== undefined && viewTime >= endCardStart
            ? refUrl(layer.whitePath)
            : null;
        return (
          <div
            key={c.id}
            className={`ve-layer-box ${layer.kind}${c.id === selectedId ? ' on' : ''}`}
            style={{
              left: `${c.place!.x * 100}%`,
              top: `${c.place!.y * 100}%`,
              width: layer.kind === 'footer' ? '100%' : `${sizeOf(c).w * 100}%`,
              opacity: props.fadeOpacity(c, viewTime),
            }}
            onPointerDown={(e) => begin(e, c, 'move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
            onDoubleClick={() => layer.kind === 'caption' && props.onEditText(c.id)}
          >
            <img src={white ?? img.url} alt="" draggable={false} />
            {c.id === selectedId && !props.readOnly && layer.kind !== 'footer' && (
              <span
                className="ve-layer-handle"
                aria-label="Resize"
                onPointerDown={(e) => begin(e, c, 'scale')}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                onLostPointerCapture={end}
              />
            )}
          </div>
        );
      })}
      {caught.x !== undefined && <div className="ve-guide v" style={{ left: `${caught.x * 100}%` }} />}
      {caught.y !== undefined && <div className="ve-guide h" style={{ top: `${caught.y * 100}%` }} />}
    </div>
  );
}
