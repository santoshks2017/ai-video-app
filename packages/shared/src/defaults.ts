/** A blank brief with sensible defaults, matching the legacy tool's initial form state. */

import type { Brief } from './types.js';

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
    visualStyle:
      'Bright premium modern showroom, glossy floors, realistic reflections, energetic dealership-ad feel',
    cta: 'Book your test drive today',
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
  };
}
