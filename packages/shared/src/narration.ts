import type { NarrationKey, NarrationMode } from './types.js';

/** Ported verbatim from the legacy tool's NARRATION map. */
export const NARRATION: Record<NarrationKey, NarrationMode> = {
  presenter: {
    key: 'presenter',
    label: 'Presenter on camera',
    speaks: true,
    onCameraPerson: true,
    lipSync: true,
    hint: 'A promoter speaks to camera throughout — the format in the Galaxy Honda and Premier Motors references.',
  },
  voiceover: {
    key: 'voiceover',
    label: 'Voiceover over b-roll',
    speaks: true,
    onCameraPerson: false,
    lipSync: false,
    hint: 'No one on camera. A voice narrates over car and showroom footage — safest mode for feature and close-up videos.',
  },
  silent: {
    key: 'silent',
    label: 'Music + on-screen text only',
    speaks: false,
    onCameraPerson: false,
    lipSync: false,
    hint: 'No speech at all. The story is carried by footage, on-screen text and music — how most delivery and festive reels are actually cut.',
  },
  customer: {
    key: 'customer',
    label: 'Customer speaking to camera',
    speaks: true,
    onCameraPerson: true,
    lipSync: true,
    hint: 'A real customer speaks, not a professional promoter. Delivery should stay unpolished.',
  },
};

export function narrationMode(key: NarrationKey | string | undefined): NarrationMode {
  return NARRATION[(key as NarrationKey)] ?? NARRATION.presenter;
}
