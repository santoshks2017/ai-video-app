import sharp from 'sharp';
import type { EditLayer, EditLook } from '@ava/shared';
import { cardPng, endCardPng, fitLogo, footerPng } from './post.js';

export type DrawnLayer = Exclude<EditLayer, { kind: 'logo' }>;

/**
 * One layer's picture, drawn by the same functions that drew the finished film.
 *
 * At scale 1 a caption is the very image composeFinal laid on the film. Larger, it is
 * drawn on a proportionally larger frame, so its type is set bigger rather than stretched.
 */
export async function drawLayer(layer: DrawnLayer, look: EditLook, scale = 1): Promise<Buffer> {
  if (layer.kind === 'caption') {
    const k = Math.max(0.25, Math.min(4, scale));
    return cardPng(
      layer.text,
      layer.sub,
      Math.round(look.width * k),
      Math.round(look.height * k),
      look.colours,
      look.captionHeadSize ? Math.round(look.captionHeadSize * k) : undefined,
    );
  }
  if (layer.kind === 'footer') return footerPng(layer.text, look.width, look.height, look.colours);
  return endCardPng({ lines: layer.lines, seconds: 3 }, look.width, look.height, look.colours);
}

/** A logo's artwork at a layer's size. */
export async function scaleLogo(art: Buffer, scale: number): Promise<Buffer> {
  if (Math.abs(scale - 1) < 0.001) return art;
  const m = await sharp(art).metadata();
  return sharp(art)
    .resize({ width: Math.max(1, Math.round((m.width ?? 1) * scale)), height: Math.max(1, Math.round((m.height ?? 1) * scale)), fit: 'fill' })
    .png()
    .toBuffer();
}

/** A replacement logo fitted to the film's logo box the way the film fitted its own, in colour and in white. */
export async function fitReplacementLogo(
  colour: Buffer,
  white: Buffer | null,
  look: EditLook,
): Promise<{ colour: Buffer; white?: Buffer; w: number; h: number }> {
  const c = await fitLogo(colour, look.width, look.height);
  const wv = white ? await fitLogo(white, look.width, look.height) : null;
  return { colour: c.art, ...(wv ? { white: wv.art } : {}), w: c.w, h: c.h };
}
