/**
 * How the words on a film look: the colours of its captions, footer strip and end
 * card, and where each caption sits.
 *
 * Every film used to wear the same navy panel and orange rule, with every caption
 * bottom-left — so one dealer's film looked like the next. A project now picks a
 * look, and a scene can say where its caption goes or leave it to the render, which
 * puts it wherever the shot is quietest while it is on screen.
 */

export interface OverlayTheme {
  id: string;
  name: string;
  /** The caption panel and the footer strip. */
  panel: string;
  /** Text on the panel and on the strip. */
  text: string;
  /** The rule beside a caption and its small line; the end card's call to action and top rule. */
  accent: string;
  /** The end card's ground. */
  card: string;
  /** The dealer's name on the end card. */
  cardText: string;
  /** The contact lines under it. */
  cardMuted: string;
}

export const OVERLAY_THEMES: OverlayTheme[] = [
  { id: 'midnight', name: 'Midnight', panel: '#0f1e33', text: '#ffffff', accent: '#e2600a', card: '#0f1e33', cardText: '#ffffff', cardMuted: '#c9d3e0' },
  { id: 'showroom-red', name: 'Showroom Red', panel: '#9f1d20', text: '#ffffff', accent: '#ffd166', card: '#7a1417', cardText: '#ffffff', cardMuted: '#f6d7d8' },
  { id: 'charcoal-gold', name: 'Charcoal & Gold', panel: '#18181b', text: '#ffffff', accent: '#d4a64a', card: '#111113', cardText: '#ffffff', cardMuted: '#c8c3b8' },
  { id: 'clean-white', name: 'Clean White', panel: '#ffffff', text: '#111827', accent: '#e11d48', card: '#ffffff', cardText: '#111827', cardMuted: '#4b5563' },
  { id: 'emerald', name: 'Emerald', panel: '#064e3b', text: '#ffffff', accent: '#34d399', card: '#053b2d', cardText: '#ffffff', cardMuted: '#b7e4d3' },
  { id: 'royal', name: 'Royal Blue', panel: '#1d3a8a', text: '#ffffff', accent: '#fbbf24', card: '#172e6e', cardText: '#ffffff', cardMuted: '#c7d2fe' },
  { id: 'sunset', name: 'Sunset', panel: '#7c2d12', text: '#fff7ed', accent: '#fb923c', card: '#5f220e', cardText: '#fff7ed', cardMuted: '#fed7aa' },
  { id: 'mono', name: 'Monochrome', panel: '#000000', text: '#ffffff', accent: '#ffffff', card: '#000000', cardText: '#ffffff', cardMuted: '#a3a3a3' },
];

export const CUSTOM_THEME_ID = 'custom';
export const DEFAULT_CUSTOM_COLOURS = { panel: '#0f1e33', accent: '#e2600a' };

function hex(v: string | undefined, fallback: string): string {
  const h = (v ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(h)) return h;
  if (/^#[0-9a-f]{3}$/.test(h)) return `#${[...h.slice(1)].map((c) => c + c).join('')}`;
  return fallback;
}
const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

/** Relative luminance, as the WCAG contrast formula defines it. */
export function luminance(colour: string): number {
  const [r, g, b] = rgb(hex(colour, '#000000')).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function mixHex(a: string, b: string, t: number): string {
  const x = rgb(hex(a, '#000000'));
  const y = rgb(hex(b, '#000000'));
  return `#${x.map((c, i) => Math.round(c + (y[i]! - c) * t).toString(16).padStart(2, '0')).join('')}`;
}

export const isLightColour = (colour: string): boolean => luminance(colour) > 0.4;
const readableOn = (ground: string): string => (contrast('#ffffff', ground) >= contrast('#111827', ground) ? '#ffffff' : '#111827');

/**
 * The look a project chose. Unset, or a look that no longer exists, is Midnight —
 * what every film had before. A custom look is built from two colours, with the text
 * picked to stay readable on them and an accent too faint to read pushed until it does.
 */
export function overlayTheme(id?: string, custom?: { panel?: string; accent?: string }): OverlayTheme {
  if (id === CUSTOM_THEME_ID) {
    const panel = hex(custom?.panel, DEFAULT_CUSTOM_COLOURS.panel);
    const text = readableOn(panel);
    const card = mixHex(panel, isLightColour(panel) ? '#ffffff' : '#000000', 0.15);
    const cardText = readableOn(card);
    let accent = hex(custom?.accent, DEFAULT_CUSTOM_COLOURS.accent);
    for (let i = 0; i < 8 && (contrast(accent, panel) < 3 || contrast(accent, card) < 3); i++) accent = mixHex(accent, text, 0.25);
    return { id: CUSTOM_THEME_ID, name: 'Custom', panel, text, accent, card, cardText, cardMuted: mixHex(cardText, card, 0.25) };
  }
  return OVERLAY_THEMES.find((t) => t.id === id) ?? OVERLAY_THEMES[0]!;
}

export type CardPosition =
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'middle-left'
  | 'middle-right'
  | 'top-left'
  | 'top-right';

export const CARD_POSITIONS: { id: CardPosition; label: string }[] = [
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-center', label: 'Bottom centre' },
  { id: 'bottom-right', label: 'Bottom right' },
  { id: 'middle-left', label: 'Middle left' },
  { id: 'middle-right', label: 'Middle right' },
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
];

export const isCardPosition = (v: unknown): v is CardPosition => CARD_POSITIONS.some((p) => p.id === v);
