import { useEffect, useRef, useState } from 'react';
import type { EditClip, EditLayer, EditLook } from '@ava/shared';
import { api, isApiError, refUrl } from '../../lib/api.js';

export interface LayerImage {
  url: string;
  /** Pixels on the film's frame, at the layer's size. */
  width: number;
  height: number;
}
type Drawn = Exclude<EditLayer, { kind: 'logo' }>;

/** Pictures already drawn, for as long as the page is open: the same words in the same look are drawn once. */
const drawn = new Map<string, Promise<LayerImage | null>>();

const keyOf = (layer: Drawn, look: EditLook, scale: number): string =>
  JSON.stringify([layer, look.colours, look.width, look.height, look.captionHeadSize ?? 0, layer.kind === 'caption' ? Math.round(scale * 100) / 100 : 1]);

function draw(layer: Drawn, look: EditLook, scale: number): Promise<LayerImage | null> {
  const key = keyOf(layer, look, scale);
  let p = drawn.get(key);
  if (!p) {
    p = api
      .drawLayer(layer, look, layer.kind === 'caption' ? scale : 1)
      .then((r) => (isApiError(r) || !r.png ? null : { url: `data:image/png;base64,${r.png}`, width: r.width, height: r.height }));
    drawn.set(key, p);
    // A picture that could not be drawn is asked for again next time.
    void p.then((img) => {
      if (!img) drawn.delete(key);
    });
  }
  return p;
}

/**
 * Every layer's picture, by clip id. A caption being typed keeps its last picture until
 * the new one is drawn, a quarter of a second after the typing stops.
 */
export function useLayerImages(clips: EditClip[], look: EditLook | undefined): Map<string, LayerImage> {
  const [images, setImages] = useState(() => new Map<string, LayerImage>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const layered = look ? clips.filter((c) => c.layer) : [];
  const signature = look ? JSON.stringify([look, layered.map((c) => [c.id, c.layer, c.place?.scale ?? 1])]) : '';

  useEffect(() => {
    if (!look) return;
    let alive = true;
    const put = (id: string, img: LayerImage): void =>
      setImages((m) => {
        const cur = m.get(id);
        if (cur && cur.url === img.url && cur.width === img.width && cur.height === img.height) return m;
        const next = new Map(m);
        next.set(id, img);
        return next;
      });
    for (const c of layered) {
      const layer = c.layer!;
      const scale = c.place?.scale ?? 1;
      if (layer.kind === 'logo') {
        put(c.id, { url: refUrl(layer.colourPath), width: layer.w * scale, height: layer.h * scale });
        continue;
      }
      const fetchIt = (): void =>
        void draw(layer, look, scale).then((img) => {
          if (alive && img) put(c.id, img);
        });
      if (drawn.has(keyOf(layer, look, scale))) fetchIt();
      else timers.current.set(c.id, setTimeout(fetchIt, 250));
    }
    return () => {
      alive = false;
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return images;
}
