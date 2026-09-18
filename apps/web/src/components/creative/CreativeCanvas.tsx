import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CreativeDoc } from '@ava/shared';
import { drawCreative, loadCreativeFonts, loadCreativeImages } from './render.js';

/** A creative drawn at a width on the page, sharp on a high-density screen. */
export function CreativeCanvas({ doc, width, style, className }: { doc: CreativeDoc; width: number; style?: CSSProperties; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const height = Math.round((width * doc.height) / doc.width);
  useEffect(() => {
    let alive = true;
    void (async () => {
      await loadCreativeFonts(doc);
      const images = await loadCreativeImages(doc);
      const c = ref.current;
      if (!alive || !c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const scale = (width / doc.width) * dpr;
      c.width = Math.max(1, Math.round(doc.width * scale));
      c.height = Math.max(1, Math.round(doc.height * scale));
      const ctx = c.getContext('2d');
      if (!ctx) return;
      drawCreative(ctx, doc, { scale, images });
      setDrawn(true);
    })();
    return () => {
      alive = false;
    };
  }, [doc, width]);
  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width, height, display: 'block', background: drawn ? undefined : doc.background, ...style }}
      aria-label={`A ${doc.width}×${doc.height} creative`}
      role="img"
    />
  );
}
