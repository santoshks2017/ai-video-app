import {
  CUSTOM_THEME_ID,
  DEFAULT_CUSTOM_COLOURS,
  OVERLAY_THEMES,
  overlayTheme,
  type OverlayTheme,
  type ProjectVideoSpec,
} from '@ava/shared';

/**
 * Pick the look of a film's words: the caption panel, the footer strip and the end
 * card, each tile drawn in the colours it will be rendered in, with this project's own
 * dealer name, call to action and footer on it.
 */
export function LookPicker({
  value,
  custom,
  onChange,
  dealer,
  cta,
  footer,
}: {
  value?: string;
  custom?: { panel: string; accent: string };
  onChange: (patch: Partial<ProjectVideoSpec>) => void;
  dealer?: string;
  cta?: string;
  footer?: string;
}) {
  const colours = custom ?? DEFAULT_CUSTOM_COLOURS;
  const options = [...OVERLAY_THEMES, overlayTheme(CUSTOM_THEME_ID, colours)];
  const chosen = options.some((t) => t.id === value) ? value : OVERLAY_THEMES[0]!.id;
  return (
    <div className="look-picker">
      <div className="look-grid" role="radiogroup" aria-label="Look of the on-screen text">
        {options.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={chosen === t.id}
            className={`look-tile${chosen === t.id ? ' on' : ''}`}
            onClick={() =>
              onChange({ overlayThemeId: t.id, ...(t.id === CUSTOM_THEME_ID && !custom ? { overlayCustom: DEFAULT_CUSTOM_COLOURS } : {}) })
            }
          >
            <LookPreview theme={t} dealer={dealer} cta={cta} footer={footer} />
            <span className="look-name">{t.name}</span>
          </button>
        ))}
      </div>
      {chosen === CUSTOM_THEME_ID && (
        <div className="look-custom">
          <label>
            <input
              type="color"
              value={colours.panel}
              onChange={(e) => onChange({ overlayCustom: { ...colours, panel: e.target.value } })}
            />
            Panel
          </label>
          <label>
            <input
              type="color"
              value={colours.accent}
              onChange={(e) => onChange({ overlayCustom: { ...colours, accent: e.target.value } })}
            />
            Accent
          </label>
          <span className="hint">The text colours are chosen to stay readable on these.</span>
        </div>
      )}
    </div>
  );
}

function LookPreview({ theme, dealer, cta, footer }: { theme: OverlayTheme; dealer?: string; cta?: string; footer?: string }) {
  return (
    <span className="look-preview" aria-hidden>
      <span className="look-film">
        <span className="look-caption" style={{ background: `${theme.panel}ed`, color: theme.text }}>
          <i style={{ background: theme.accent }} />
          <b>₹40,000 off</b>
          <em style={{ color: theme.accent }}>This festive season</em>
        </span>
        <span className="look-footer" style={{ background: `${theme.panel}eb`, color: theme.text }}>
          {footer || 'Dealer · City · Phone'}
        </span>
      </span>
      <span className="look-card" style={{ background: theme.card }}>
        <i style={{ background: theme.accent }} />
        <b style={{ color: theme.cardText }}>{dealer || 'Dealer name'}</b>
        <em style={{ color: theme.accent }}>{cta || 'Book a test drive'}</em>
        <small style={{ color: theme.cardMuted }}>+91 98765 43210</small>
      </span>
    </span>
  );
}
