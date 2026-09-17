/** A blank brief with sensible defaults, matching the legacy tool's initial form state. */

import type { Brief } from './types.js';

/**
 * What a blank brief starts with. Every project is created carrying these already, so a
 * manufacturer's film would inherit a showroom look nobody chose — buildContext treats a
 * value still equal to these as the blank it is.
 */
export const DEALER_VISUAL_STYLE =
  'Bright premium modern showroom, glossy floors, realistic reflections, energetic dealership-ad feel';
export const DEALER_CTA = 'Book your test drive today';

/** What a manufacturer's film looks like and asks for, where a dealership's default would be wrong. */
export const OEM_VISUAL_STYLE =
  'Cinematic brand film — real locations, natural light, the car as the hero, nothing of a showroom in frame';
export const OEM_CTA = 'Find your nearest authorised showroom';

/**
 * The look and the call to action a film will actually use. A project is created holding
 * the dealership defaults, so a manufacturer's film swaps them for its own — and the
 * editor shows the same thing, or the field and the film would disagree.
 */
export function effectiveLook(
  kind: 'dealer' | 'oem' | undefined,
  spec: { visualStyle: string; cta: string },
): { visualStyle: string; cta: string } {
  const oem = kind === 'oem';
  return {
    visualStyle: oem && spec.visualStyle.trim() === DEALER_VISUAL_STYLE ? OEM_VISUAL_STYLE : spec.visualStyle,
    cta: oem && spec.cta.trim() === DEALER_CTA ? OEM_CTA : spec.cta,
  };
}

export function emptyBrief(): Brief {
  return {
    categories: [],
    narration: 'presenter',
    modelSpecific: false,
    carModel: '',
    durationSec: 27,
    maxChunkSec: 10,
    aspect: '9:16',
    resolution: '720p',
    music: '',
    textLang: 'english',
    captionStyle: 'Long Narrative',
    visualStyle: DEALER_VISUAL_STYLE,
    cta: DEALER_CTA,
    footer: '',
    endCardOn: true,
    endCard: '',
    dealer: {
      dealerName: '',
      brandModel: '',
      phone: '',
      tier: 'Metro Premium',
      address: '',
      fictionalize: true,
      fakeBrandModel: '',
      fakeDealer: '',
      photos: [],
    },
    actor: { name: '', gender: 'female', age: '', style: '', voice: '', sourceNote: '' },
    fieldValues: {},
    attachments: [],
    extraDirection: [],
  };
}
