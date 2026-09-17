/**
 * Where a composed film's overlays went.
 *
 * composeFinal decides where every caption sits, how tall the footer is and where each
 * logo lands, draws them, and used to throw the decisions away. Kept, they are what
 * the video editor opens as layers over the film's clean footage. Positions are
 * pixels on the film's own frame.
 */
import type { SpeechSpan } from './musicGain.js';

export interface LayerColours {
  panel: string;
  text: string;
  accent: string;
  card: string;
  cardText: string;
  cardMuted: string;
}
export const LAYER_COLOUR_KEYS = ['panel', 'text', 'accent', 'card', 'cardText', 'cardMuted'] as const;
export interface LayerBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface FilmCaptionLayer extends LayerBox {
  id: string;
  text: string;
  sub?: string;
  from: number;
  to: number;
  spot: string;
  /** Placed by Auto rather than by the designer. */
  auto: boolean;
}
export interface FilmFooterLayer extends LayerBox {
  text: string;
}
export interface FilmLogoLayer extends LayerBox {
  which: 'dealer' | 'brand';
  colourPath: string;
  whitePath?: string;
  whiteOnEndCard: boolean;
}
export interface FilmEndCardLayer {
  lines: string[];
  seconds: number;
}
export interface FilmMusicLayer {
  storagePath: string;
  loudness: number;
  duckDb: number;
  /** Where the film heard someone speaking, in seconds of the film: where its music dips. */
  speech?: SpeechSpan[];
  /** The track's own loudness in LUFS, before it is levelled; null when it could not be measured. */
  measured?: number | null;
}
export interface FilmLayers {
  version: 1;
  width: number;
  height: number;
  fps: number;
  speed: number;
  targetShortSide: number;
  /** Where the footage ends and the end card begins, in seconds of the finished film. */
  bodySeconds: number;
  colours: LayerColours;
  captionHeadSize?: number;
  captions: FilmCaptionLayer[];
  footer?: FilmFooterLayer;
  logos: FilmLogoLayer[];
  endCard?: FilmEndCardLayer;
  music?: FilmMusicLayer;
}
