import { useRef, useState } from 'react';
import {
  CARD_POSITIONS,
  CUSTOM_THEME_ID,
  OVERLAY_THEMES,
  editCaptionSpots,
  editClipLength,
  editSetEndCardSeconds,
  overlayTheme,
  updateEditClip,
  type EditClip,
  type EditLayer,
  type EditLook,
  type EditProject,
} from '@ava/shared';
import { api, isApiError, refUrl } from '../../lib/api.js';
import { uploadRef } from '../../lib/client.js';
import { LookPicker } from '../LookPicker.js';
import type { LayerImage } from './useLayerImages.js';

interface Props {
  clip: EditClip;
  project: EditProject;
  look: EditLook;
  images: Map<string, LayerImage>;
  readOnly: boolean;
  /** A change to this clip; the key groups quick changes into one step of history. */
  onPatch: (key: string, patch: Partial<EditClip>) => void;
  /** A change that reaches beyond this clip, such as the end card's length or the look. */
  onProject: (key: string, next: EditProject) => void;
  onDelete: () => void;
  onNotice: (text: string) => void;
}

const COLOUR_KEYS = ['panel', 'text', 'accent', 'card', 'cardText', 'cardMuted'] as const;
const sameColours = (a: EditLook['colours'], b: EditLook['colours']): boolean =>
  COLOUR_KEYS.every((k) => a[k].toLowerCase() === b[k].toLowerCase());

/** What a layer is, what it says, where it sits and how it looks — for this film only. */
export function LayerPanel({ clip, project, look, images, readOnly, onPatch, onProject, onDelete, onNotice }: Props) {
  const layer = clip.layer!;
  const place = clip.place;
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const setLayer = (key: string, next: EditLayer): void => onPatch(key, { layer: next });

  const reset = (): void => {
    const o = clip.original;
    if (!o) return;
    if (layer.kind === 'endcard' && o.layer?.kind === 'endcard') {
      onProject('reset', editSetEndCardSeconds(updateEditClip(project, clip.id, { layer: o.layer }), clip.id, o.out - o.in));
      return;
    }
    onPatch('reset', { start: o.start, in: o.in, out: o.out, layer: o.layer, place: o.place });
  };

  const size = place && layer.kind !== 'footer' && (
    <label className="ve-field">
      <span>Size · {Math.round(place.scale * 100)}%</span>
      <input
        type="range"
        min={0.5}
        max={2}
        step={0.05}
        value={place.scale}
        disabled={readOnly}
        onChange={(e) => onPatch('scale', { place: { ...place, scale: Number(e.target.value) } })}
      />
    </label>
  );

  const footerClip = project.clips.find((c) => c.layer?.kind === 'footer');
  const footerH = footerClip ? (images.get(footerClip.id)?.height ?? 0) : 0;
  const endCard = project.clips.find((c) => c.layer?.kind === 'endcard')?.layer;
  const dealerLine = endCard?.kind === 'endcard' ? endCard.lines[0] : undefined;
  const themeNow = OVERLAY_THEMES.find((t) => sameColours(t, look.colours));
  const custom = { panel: look.colours.panel, accent: look.colours.accent };

  const replaceLogo = async (f: File | undefined): Promise<void> => {
    if (!f || layer.kind !== 'logo') return;
    setBusy(true);
    const up = await uploadRef(f, layer.which === 'dealer' ? 'Dealer logo' : 'Brand logo', 'logo');
    if (isApiError(up)) {
      setBusy(false);
      onNotice(up.message);
      return;
    }
    const fit = await api.fitLogo(up.storagePath, up.white?.storagePath, look);
    setBusy(false);
    if (isApiError(fit)) {
      onNotice(fit.message);
      return;
    }
    setLayer('logo', {
      ...layer,
      colourPath: fit.colourPath,
      whitePath: fit.whitePath,
      w: fit.w,
      h: fit.h,
      whiteOnEndCard: layer.whiteOnEndCard && Boolean(fit.whitePath),
    });
  };

  const heading =
    layer.kind === 'caption' ? 'Caption' : layer.kind === 'footer' ? 'Footer' : layer.kind === 'logo' ? (layer.which === 'dealer' ? 'Dealer logo' : 'Brand logo') : 'End card';

  return (
    <div className="ve-props">
      <div className="ve-props-head">
        <b>{heading}</b>
        <span>{editClipLength(clip).toFixed(1)}s · this film only</span>
      </div>

      {layer.kind === 'caption' &&
        place &&
        (() => {
          const img = images.get(clip.id);
          const spots = img ? editCaptionSpots(look, { w: img.width, h: img.height }, footerH) : [];
          const spotNow = spots.find((s) => Math.abs(s.x - place.x) < 0.002 && Math.abs(s.y - place.y) < 0.002)?.spot ?? 'custom';
          return (
            <>
              <label className="ve-field">
                <span>Words</span>
                <textarea rows={2} maxLength={200} value={layer.text} disabled={readOnly} onChange={(e) => setLayer('text', { ...layer, text: e.target.value })} />
              </label>
              {!layer.text.trim() && <div className="ve-hint">A caption needs words. To take it off the film, delete it.</div>}
              <label className="ve-field">
                <span>Second line</span>
                <input
                  maxLength={200}
                  value={layer.sub ?? ''}
                  disabled={readOnly}
                  onChange={(e) => setLayer('sub', { kind: 'caption', text: layer.text, ...(e.target.value ? { sub: e.target.value } : {}) })}
                />
              </label>
              <label className="ve-field">
                <span>Position</span>
                <select
                  value={spotNow}
                  disabled={readOnly || !spots.length}
                  onChange={(e) => {
                    const s = spots.find((x) => x.spot === e.target.value);
                    if (s) onPatch('place', { place: { ...place, x: s.x, y: s.y } });
                  }}
                >
                  {CARD_POSITIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom" disabled>
                    Where you dragged it
                  </option>
                </select>
              </label>
              {size}
            </>
          );
        })()}

      {layer.kind === 'footer' && place && (
        <>
          <label className="ve-field">
            <span>Text</span>
            <textarea rows={2} maxLength={300} value={layer.text} disabled={readOnly} onChange={(e) => setLayer('text', { ...layer, text: e.target.value })} />
          </label>
          <label className="ve-field">
            <span>Position</span>
            <select
              value={place.y <= 0.001 ? 'top' : Math.abs(place.y - (look.height - footerH) / look.height) < 0.002 ? 'bottom' : 'custom'}
              disabled={readOnly}
              onChange={(e) => onPatch('place', { place: { ...place, x: 0, y: e.target.value === 'top' ? 0 : (look.height - footerH) / look.height } })}
            >
              <option value="bottom">Bottom</option>
              <option value="top">Top</option>
              <option value="custom" disabled>
                Where you dragged it
              </option>
            </select>
          </label>
        </>
      )}

      {layer.kind === 'logo' && place && (
        <>
          <div className="ve-logo-preview">
            <img src={refUrl(layer.colourPath)} alt="" />
          </div>
          <button type="button" className="ve-btn ghost" disabled={readOnly || busy} onClick={() => file.current?.click()}>
            {busy ? 'Fitting the logo…' : 'Replace logo'}
          </button>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void replaceLogo(e.target.files?.[0]);
              // The same file picked again, after a fit that failed, is a new pick.
              e.target.value = '';
            }}
          />
          {size}
          <label className="ve-check">
            <input
              type="checkbox"
              checked={layer.whiteOnEndCard}
              disabled={readOnly || !layer.whitePath}
              onChange={(e) => setLayer('white', { ...layer, whiteOnEndCard: e.target.checked })}
            />
            <span>White on a dark end card</span>
          </label>
        </>
      )}

      {layer.kind === 'endcard' && (
        <>
          <label className="ve-field">
            <span>Lines · name, call to action, contact</span>
            <textarea
              rows={4}
              value={layer.lines.join('\n')}
              disabled={readOnly}
              onChange={(e) => setLayer('lines', { kind: 'endcard', lines: e.target.value.split('\n').slice(0, 6).map((l) => l.slice(0, 160)) })}
            />
          </label>
          <label className="ve-field">
            <span>Holds for · {editClipLength(clip).toFixed(1)}s</span>
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={editClipLength(clip)}
              disabled={readOnly}
              onChange={(e) => onProject('seconds', editSetEndCardSeconds(project, clip.id, Number(e.target.value)))}
            />
          </label>
        </>
      )}

      <div className="ve-field">
        <span>Look · every layer</span>
        <LookPicker
          value={themeNow?.id ?? CUSTOM_THEME_ID}
          custom={custom}
          dealer={dealerLine}
          footer={footerClip?.layer?.kind === 'footer' ? footerClip.layer.text : undefined}
          onChange={(patch) => {
            if (readOnly) return;
            const t = overlayTheme(patch.overlayThemeId ?? themeNow?.id ?? CUSTOM_THEME_ID, patch.overlayCustom ?? custom);
            onProject('look', {
              ...project,
              look: { ...look, colours: { panel: t.panel, text: t.text, accent: t.accent, card: t.card, cardText: t.cardText, cardMuted: t.cardMuted } },
            });
          }}
        />
      </div>

      <div className="ve-row">
        <button type="button" className="ve-btn ghost" disabled={readOnly || !clip.original} onClick={reset}>
          Reset to original
        </button>
        <button type="button" className="ve-btn ghost" disabled={readOnly} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
