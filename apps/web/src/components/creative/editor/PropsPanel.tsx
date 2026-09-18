import { useEffect, useRef, type RefObject } from 'react';
import {
  CREATIVE_FONTS,
  CREATIVE_FORMAT_BY_ID,
  type CreativeDoc,
  type CreativeLayer,
  type ImageAdjust,
  type ImageLayer,
  type ShapeLayer,
  type TextLayer,
} from '@ava/shared';
import { ColourField, Group, NumField, Segmented, Slider, Switch, Toggle } from './fields.js';
import { Icon } from './icons.js';
import { WEIGHT_NAMES, fontWeightsOf, nearestWeight } from './newLayers.js';

export type LayerPatch = Partial<ImageLayer> | Partial<TextLayer> | Partial<ShapeLayer>;
/** A change to the selected layer. With a key, a run of changes to that field is one step of history. */
type Change<T> = (patch: Partial<T>, key?: string) => void;

const KIND_NAME = { text: 'Text', image: 'Picture', shape: 'Shape' } as const;
const ROLE_NAME: Record<string, string> = { cta: 'Call to action', 'cta-text': 'Call to action words', sub: 'Supporting line', 'badge-text': 'Badge words' };
const roleName = (role: string): string => ROLE_NAME[role] ?? role.charAt(0).toUpperCase() + role.slice(1).replace(/-/g, ' ');
const two = (v: number): string => v.toFixed(2);
const signed = (v: number): string => (v > 0 ? `+${v}` : String(v));

/**
 * The properties of the selected layer, or of the document when nothing is selected. Every
 * control writes straight into the document, so the canvas follows as the value changes.
 */
export function PropsPanel({
  doc,
  layer,
  onChange,
  onBackground,
  onArrange,
  onReplacePicture,
  onDownload,
  exporting,
  focusText,
}: {
  doc: CreativeDoc;
  layer: CreativeLayer | null;
  onChange: (patch: LayerPatch, key?: string) => void;
  onBackground: (colour: string) => void;
  onArrange: (to: 'up' | 'down' | 'top' | 'bottom') => void;
  onReplacePicture: () => void;
  onDownload: (type: 'png' | 'jpg') => void;
  exporting: 'png' | 'jpg' | null;
  /** Bumped to put the cursor in the words of the selected text layer. */
  focusText: number;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focusText) return;
    const t = textRef.current;
    if (!t) return;
    t.focus({ preventScroll: false });
    t.select();
  }, [focusText]);

  if (!layer) {
    const format = CREATIVE_FORMAT_BY_ID[doc.format];
    return (
      <aside className="ce-panel ce-props" aria-label="Properties">
        <div className="ce-panel-head">
          <h3>Document</h3>
        </div>
        <div className="ce-props-body">
          <Group title="Frame">
            <p className="ce-fact">
              <b>
                {doc.width} × {doc.height}
              </b>{' '}
              · {format?.label ?? doc.format}
            </p>
            {format?.platforms && <p className="ce-hint">{format.platforms}</p>}
            <ColourField label="Background" value={doc.background} onChange={onBackground} />
          </Group>
          <Group title="Download">
            <div className="ce-row">
              <button type="button" className="ce-btn ce-sm" disabled={Boolean(exporting)} onClick={() => onDownload('png')}>
                <Icon name="download" size={15} />
                {exporting === 'png' ? 'Preparing…' : 'PNG'}
              </button>
              <button type="button" className="ce-btn ce-sm" disabled={Boolean(exporting)} onClick={() => onDownload('jpg')}>
                <Icon name="download" size={15} />
                {exporting === 'jpg' ? 'Preparing…' : 'JPG'}
              </button>
            </div>
          </Group>
          <p className="ce-hint">
            Click a layer on the canvas or in the list to change it. Drop or paste a picture on the canvas to add it.
            Hold Space and drag to move around; Ctrl or ⌘ with the wheel zooms.
          </p>
        </div>
      </aside>
    );
  }

  const index = doc.layers.findIndex((l) => l.id === layer.id);
  const top = doc.layers.length - 1;
  const locked = Boolean(layer.locked);
  const W = doc.width;
  const H = doc.height;
  const num =
    (field: 'x' | 'y' | 'w' | 'h' | 'rotation') =>
    (v: number | undefined): void => {
      if (v === undefined) return;
      const patch: Partial<Pick<CreativeLayer, 'x' | 'y' | 'w' | 'h' | 'rotation'>> = {};
      patch[field] = v;
      onChange(patch, field);
    };

  return (
    <aside className="ce-panel ce-props" aria-label="Properties">
      <div className="ce-panel-head">
        <h3>{layer.kind === 'shape' ? (layer.shape === 'ellipse' ? 'Ellipse' : layer.shape === 'line' ? 'Line' : 'Rectangle') : KIND_NAME[layer.kind]}</h3>
        {layer.role && (
          <span className="ce-chip" title="The app placed this layer: new words or a new look reach it without undoing your changes">
            {roleName(layer.role)}
          </span>
        )}
      </div>
      <div className="ce-props-body" key={layer.id}>
        <label className="ce-field">
          <span className="ce-label">Name</span>
          <input type="text" value={layer.name} maxLength={80} spellCheck={false} onChange={(e) => onChange({ name: e.target.value }, 'name')} />
        </label>

        {layer.kind === 'text' && <TextProps l={layer} onChange={onChange as Change<TextLayer>} textRef={textRef} />}
        {layer.kind === 'image' && <ImageProps l={layer} onChange={onChange as Change<ImageLayer>} onReplace={onReplacePicture} />}
        {layer.kind === 'shape' && <ShapeProps l={layer} onChange={onChange as Change<ShapeLayer>} />}

        <Group title="Position and size" aside={locked ? <span className="ce-note">Locked</span> : undefined}>
          <div className="ce-grid2">
            <NumField label="X" value={layer.x} min={-3 * W} max={4 * W} onChange={num('x')} disabled={locked} suffix="px" />
            <NumField label="Y" value={layer.y} min={-3 * H} max={4 * H} onChange={num('y')} disabled={locked} suffix="px" />
            <NumField label="W" value={layer.w} min={1} max={6 * W} onChange={num('w')} disabled={locked} suffix="px" />
            <NumField label="H" value={layer.h} min={1} max={6 * H} onChange={num('h')} disabled={locked} suffix="px" />
            <NumField label="Angle" value={layer.rotation} min={-180} max={180} digits={1} onChange={num('rotation')} disabled={locked} suffix="°" />
          </div>
        </Group>

        <Group title="Layer">
          <Slider label="Opacity" value={Math.round(layer.opacity * 100)} min={0} max={100} step={1} format={(v) => `${v}%`} onChange={(v) => onChange({ opacity: v / 100 }, 'opacity')} />
          <div className="ce-row ce-row-wrap">
            <Toggle label="Hidden" checked={Boolean(layer.hidden)} onChange={(v) => onChange({ hidden: v })} />
            <Toggle label="Locked" checked={locked} onChange={(v) => onChange({ locked: v })} title="A locked layer cannot be moved, resized or turned on the canvas" />
          </div>
          <div className="ce-arrange" role="group" aria-label="Arrange">
            <button type="button" className="ce-btn ce-sm" disabled={index >= top} onClick={() => onArrange('up')} title="Bring forward">
              <Icon name="forward" size={15} />
              Forward
            </button>
            <button type="button" className="ce-btn ce-sm" disabled={index <= 0} onClick={() => onArrange('down')} title="Send backward">
              <Icon name="backward" size={15} />
              Backward
            </button>
            <button type="button" className="ce-btn ce-sm" disabled={index >= top} onClick={() => onArrange('top')} title="Bring to front">
              <Icon name="front" size={15} />
              To front
            </button>
            <button type="button" className="ce-btn ce-sm" disabled={index <= 0} onClick={() => onArrange('bottom')} title="Send to back">
              <Icon name="back" size={15} />
              To back
            </button>
          </div>
        </Group>
      </div>
    </aside>
  );
}

/* ---- text ---- */

function TextProps({ l, onChange, textRef }: { l: TextLayer; onChange: Change<TextLayer>; textRef: RefObject<HTMLTextAreaElement> }) {
  const weights = fontWeightsOf(l.font);
  const weightOptions = weights.includes(l.weight) ? weights : [...weights, l.weight].sort((a, b) => a - b);
  return (
    <>
      <Group title="Words">
        <textarea
          ref={textRef}
          className="ce-words"
          rows={3}
          maxLength={600}
          value={l.text}
          aria-label="Words"
          onChange={(e) => onChange({ text: e.target.value }, 'text')}
        />
        <span className="ce-counter">{l.text.length} / 600</span>
      </Group>

      <Group title="Type">
        <label className="ce-field">
          <span className="ce-label">Font</span>
          <select
            value={l.font}
            onChange={(e) => {
              const font = e.target.value;
              // A weight the face does not have would be faked by thickening it; the nearest real one reads better.
              onChange({ font, weight: nearestWeight(font, l.weight) });
            }}
          >
            {CREATIVE_FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} — {f.note}
              </option>
            ))}
          </select>
        </label>
        <div className="ce-grid2">
          <NumField label="Size" value={l.size} min={4} max={800} onChange={(v) => v !== undefined && onChange({ size: v }, 'size')} suffix="px" title="The largest the words are drawn; they shrink to fit the box" />
          <label className="ce-field">
            <span className="ce-sr">Weight</span>
            <select value={l.weight} onChange={(e) => onChange({ weight: Number(e.target.value) })}>
              {weightOptions.map((w) => (
                <option key={w} value={w}>
                  {w} {WEIGHT_NAMES[w] ?? ''}
                  {weights.includes(w) ? '' : ' (not in this font)'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ColourField label="Colour" value={l.color} onChange={(color) => onChange({ color }, 'color')} />
        <div className="ce-row ce-row-wrap">
          <Toggle label="Italic" checked={Boolean(l.italic)} onChange={(v) => onChange({ italic: v })} />
          <Toggle label="CAPS" checked={Boolean(l.caps)} onChange={(v) => onChange({ caps: v })} />
        </div>
        <Segmented
          label="Align"
          value={l.align}
          onChange={(align) => onChange({ align })}
          options={[
            { value: 'left', text: 'Left' },
            { value: 'center', text: 'Centre' },
            { value: 'right', text: 'Right' },
          ]}
        />
        <Segmented
          label="In the box"
          value={l.valign}
          onChange={(valign) => onChange({ valign })}
          options={[
            { value: 'top', text: 'Top' },
            { value: 'middle', text: 'Middle' },
            { value: 'bottom', text: 'Bottom' },
          ]}
        />
        <div className="ce-grid2">
          <NumField label="Line height" wide value={l.lineHeight} min={0.6} max={3} step={0.05} digits={2} onChange={(v) => v !== undefined && onChange({ lineHeight: v }, 'lineHeight')} suffix="×" />
          <NumField
            label="Spacing"
            wide
            value={l.letterSpacing}
            min={-0.3}
            max={1}
            step={0.01}
            digits={2}
            onChange={(v) => v !== undefined && onChange({ letterSpacing: v }, 'letterSpacing')}
            suffix="em"
          />
          <NumField label="Max lines" wide value={l.maxLines} min={1} max={30} blank="No limit" onChange={(v) => onChange({ maxLines: v }, 'maxLines')} />
        </div>
      </Group>

      <Group title="Shadow" aside={<Switch label="Shadow" checked={Boolean(l.shadow)} onChange={(v) => onChange({ shadow: v ? { color: 'rgba(0,0,0,0.45)', blur: 18, x: 0, y: 3 } : undefined })} />}>
        {l.shadow && (
          <>
            <ColourField label="Colour" value={l.shadow.color} onChange={(color) => onChange({ shadow: { ...l.shadow!, color } }, 'shadow-colour')} />
            <Slider label="Blur" value={l.shadow.blur} min={0} max={60} step={1} format={(v) => `${v}px`} onChange={(blur) => onChange({ shadow: { ...l.shadow!, blur } }, 'shadow-blur')} />
            {l.pill && <p className="ce-hint">Not drawn while the words sit on a pill.</p>}
          </>
        )}
      </Group>

      <Group title="Outline" aside={<Switch label="Outline" checked={Boolean(l.stroke)} onChange={(v) => onChange({ stroke: v ? { color: '#000000', width: 3 } : undefined })} />}>
        {l.stroke && (
          <>
            <ColourField label="Colour" value={l.stroke.color} onChange={(color) => onChange({ stroke: { ...l.stroke!, color } }, 'stroke-colour')} />
            <Slider label="Width" value={l.stroke.width} min={0} max={30} step={0.5} format={(v) => `${v}px`} onChange={(width) => onChange({ stroke: { ...l.stroke!, width } }, 'stroke-width')} />
          </>
        )}
      </Group>

      <Group
        title="Pill behind the words"
        aside={
          <Switch
            label="Pill behind the words"
            checked={Boolean(l.pill)}
            onChange={(v) =>
              onChange({ pill: v ? { color: '#e2600a', padX: Math.round(l.size * 0.5), padY: Math.round(l.size * 0.25), radius: Math.round(l.size * 0.5) } : undefined })
            }
          />
        }
      >
        {l.pill && (
          <>
            <ColourField label="Colour" value={l.pill.color} onChange={(color) => onChange({ pill: { ...l.pill!, color } }, 'pill-colour')} />
            <div className="ce-grid3">
              <NumField label="Pad X" wide value={l.pill.padX} min={0} max={400} onChange={(v) => v !== undefined && onChange({ pill: { ...l.pill!, padX: v } }, 'pill-padx')} />
              <NumField label="Pad Y" wide value={l.pill.padY} min={0} max={400} onChange={(v) => v !== undefined && onChange({ pill: { ...l.pill!, padY: v } }, 'pill-pady')} />
              <NumField label="Radius" wide value={l.pill.radius} min={0} max={800} onChange={(v) => v !== undefined && onChange({ pill: { ...l.pill!, radius: v } }, 'pill-radius')} />
            </div>
          </>
        )}
      </Group>
    </>
  );
}

/* ---- pictures ---- */

const ADJUSTMENTS: Array<{ key: keyof ImageAdjust; label: string; min: number; max: number; step: number; format: (v: number) => string }> = [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, format: signed },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, format: signed },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, format: signed },
  { key: 'warmth', label: 'Warmth', min: -100, max: 100, step: 1, format: signed },
  { key: 'blur', label: 'Blur', min: 0, max: 40, step: 0.5, format: (v) => `${v}px` },
];

function ImageProps({ l, onChange, onReplace }: { l: ImageLayer; onChange: Change<ImageLayer>; onReplace: () => void }) {
  const adjust = l.adjust ?? {};
  const adjusted = ADJUSTMENTS.some((a) => adjust[a.key]);
  return (
    <>
      <Group title="Picture">
        <div className="ce-pic-row">
          <img className="ce-thumb" src={l.src} alt="" draggable={false} />
          <button type="button" className="ce-btn ce-sm" onClick={onReplace}>
            <Icon name="picture" size={15} />
            Replace…
          </button>
        </div>
        <Segmented
          label="Fit"
          value={l.fit}
          onChange={(fit) => onChange({ fit })}
          options={[
            { value: 'cover', text: 'Cover', title: 'Fill the box; the picture is cropped' },
            { value: 'contain', text: 'Contain', title: 'The whole picture, inside the box' },
          ]}
        />
        <Slider label="Focus X" value={l.focusX} min={0} max={1} step={0.01} format={two} onChange={(focusX) => onChange({ focusX }, 'focusX')} />
        <Slider label="Focus Y" value={l.focusY} min={0} max={1} step={0.01} format={two} onChange={(focusY) => onChange({ focusY }, 'focusY')} />
        <Slider label="Zoom" value={l.zoom} min={1} max={4} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(zoom) => onChange({ zoom }, 'zoom')} />
        <div className="ce-row ce-row-wrap">
          <Toggle label="Flip horizontally" checked={Boolean(l.flipX)} onChange={(v) => onChange({ flipX: v || undefined })} />
          {l.fit === 'contain' && (
            <Toggle
              label="Blurred backdrop"
              checked={l.backdrop === 'blur'}
              onChange={(v) => onChange({ backdrop: v ? 'blur' : undefined })}
              title="Fill the rest of the box with a blurred, darker copy of the picture"
            />
          )}
        </div>
        <NumField label="Corner radius" wide value={l.radius ?? 0} min={0} max={Math.max(0, Math.round(Math.min(l.w, l.h) / 2))} onChange={(v) => onChange({ radius: v || undefined }, 'radius')} suffix="px" />
      </Group>

      <Group
        title="Adjustments"
        aside={
          <button type="button" className="ce-link" disabled={!adjusted} onClick={() => onChange({ adjust: undefined })}>
            Reset
          </button>
        }
      >
        {ADJUSTMENTS.map((a) => (
          <Slider
            key={a.key}
            label={a.label}
            value={adjust[a.key] ?? 0}
            min={a.min}
            max={a.max}
            step={a.step}
            format={a.format}
            onChange={(v) => onChange({ adjust: { ...adjust, [a.key]: v } }, `adjust-${a.key}`)}
          />
        ))}
      </Group>
    </>
  );
}

/* ---- shapes ---- */

function ShapeProps({ l, onChange }: { l: ShapeLayer; onChange: Change<ShapeLayer> }) {
  return (
    <>
      <Group title="Shape">
        <Segmented
          label="Kind"
          value={l.shape}
          onChange={(shape) => onChange({ shape })}
          options={[
            { value: 'rect', text: 'Rectangle' },
            { value: 'ellipse', text: 'Ellipse' },
            { value: 'line', text: 'Line' },
          ]}
        />
        {!l.gradient && <ColourField label="Fill" value={l.fill ?? ''} placeholder="None" onChange={(fill) => onChange({ fill }, 'fill')} />}
        {l.shape !== 'ellipse' && (
          <NumField
            label="Corner radius"
            wide
            value={l.radius ?? 0}
            min={0}
            max={Math.max(0, Math.round(Math.min(l.w, l.h) / 2))}
            onChange={(v) => onChange({ radius: v || undefined }, 'radius')}
            suffix="px"
          />
        )}
      </Group>

      <Group
        title="Gradient"
        aside={<Switch label="Gradient" checked={Boolean(l.gradient)} onChange={(v) => onChange({ gradient: v ? { from: l.fill || '#e2600a', to: 'rgba(0,0,0,0)', angle: 0 } : undefined })} />}
      >
        {l.gradient && (
          <>
            <ColourField label="From" value={l.gradient.from} onChange={(from) => onChange({ gradient: { ...l.gradient!, from } }, 'gradient-from')} />
            <ColourField label="To" value={l.gradient.to} onChange={(to) => onChange({ gradient: { ...l.gradient!, to } }, 'gradient-to')} />
            <Slider label="Angle" value={l.gradient.angle} min={0} max={360} step={1} format={(v) => `${v}°`} onChange={(angle) => onChange({ gradient: { ...l.gradient!, angle } }, 'gradient-angle')} />
            <p className="ce-hint">0° runs top to bottom, turning clockwise: 270° runs left to right.</p>
          </>
        )}
      </Group>

      <Group title="Outline" aside={<Switch label="Outline" checked={Boolean(l.stroke)} onChange={(v) => onChange({ stroke: v ? { color: '#ffffff', width: 4 } : undefined })} />}>
        {l.stroke && (
          <>
            <ColourField label="Colour" value={l.stroke.color} onChange={(color) => onChange({ stroke: { ...l.stroke!, color } }, 'stroke-colour')} />
            <Slider label="Width" value={l.stroke.width} min={0} max={40} step={0.5} format={(v) => `${v}px`} onChange={(width) => onChange({ stroke: { ...l.stroke!, width } }, 'stroke-width')} />
          </>
        )}
      </Group>
    </>
  );
}
