import { useEffect, useRef, useState } from 'react';
import type { CreativeDoc } from '@ava/shared';
import { loadCreativeFonts, loadCreativeImages, loadImage } from '../render.js';

/**
 * The fonts and pictures a creative is drawn with: everything it opens with is loaded before
 * its first drawing, and anything new — a face for new words, a picture just added — is loaded
 * as the document asks for it.
 */

/** The faces the words need: a new one is loaded before the canvas draws those words. */
function fontKeyOf(doc: CreativeDoc): string {
  const parts: string[] = [];
  for (const l of doc.layers) {
    if (l.kind !== 'text' || !l.text.trim()) continue;
    parts.push(`${l.font}|${l.weight}|${l.italic ? 1 : 0}|${[...new Set(l.text)].sort().join('')}`);
  }
  return parts.sort().join('\n');
}

/**
 * The faces a creative's words use, loaded. The renderer remembers a face as asked for as soon
 * as one drawing asks, so a second drawing asking at the same moment is answered before the face
 * has arrived; waiting for the page's fonts to settle as well covers that — a word measured in
 * a stand-in face would keep its wrong line breaks in the renderer's cache, and in the download.
 */
async function fontsFor(doc: CreativeDoc): Promise<void> {
  await loadCreativeFonts(doc);
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  // Never hang the canvas on a face that does not come.
  let timer = 0;
  await Promise.race([document.fonts.ready, new Promise((resolve) => (timer = window.setTimeout(resolve, 3000)))]);
  window.clearTimeout(timer);
}

export function useCreativeAssets(doc: CreativeDoc, onPictureError: (src: string) => void) {
  const [ready, setReady] = useState(false);
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(() => new Map());
  const [, setFontTick] = useState(0);
  const fontKeys = useRef(new Set<string>());
  const asked = useRef(new Set<string>());
  const alive = useRef(false);
  const reportError = useRef(onPictureError);
  reportError.current = onPictureError;
  const opened = useRef(doc);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Everything the creative draws when it opens, before its first drawing.
  useEffect(() => {
    let current = true;
    const first = opened.current;
    const key = fontKeyOf(first);
    void Promise.all([fontsFor(first), loadCreativeImages(first)]).then(([, loaded]) => {
      if (!current) return;
      fontKeys.current.add(key);
      for (const l of first.layers) {
        if (l.kind !== 'image' || asked.current.has(l.src)) continue;
        asked.current.add(l.src);
        if (!loaded.has(l.src)) reportError.current(l.src);
      }
      setImages(loaded);
      setReady(true);
    });
    return () => {
      current = false;
    };
  }, []);

  const key = fontKeyOf(doc);
  useEffect(() => {
    if (!ready || fontKeys.current.has(key)) return;
    void fontsFor(doc).then(() => {
      if (fontKeys.current.size > 400) fontKeys.current.clear();
      fontKeys.current.add(key);
      if (alive.current) setFontTick((n) => n + 1);
    });
    // The key names everything about the document the fonts depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);

  // A picture that is new since the last drawing: drawn again once it has arrived.
  useEffect(() => {
    if (!ready) return;
    for (const l of doc.layers) {
      if (l.kind !== 'image' || asked.current.has(l.src)) continue;
      const src = l.src;
      asked.current.add(src);
      void loadImage(src).then((img) => {
        if (!alive.current) return;
        if (img) setImages((m) => new Map(m).set(src, img));
        else reportError.current(src);
      });
    }
  }, [ready, doc]);

  return { ready, images, fontsReady: fontKeys.current.has(key) };
}
