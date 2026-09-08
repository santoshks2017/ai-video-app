/**
 * Starting content for the Languages library.
 *
 * These are seeds, not constants: once a language exists in Firestore the app
 * never reads these again, and the guides are edited in the Languages section.
 * Everything a video model needs to know about how a language is spoken and
 * written lives there, so tuning delivery is an app change, not a code change.
 */

import type { LanguageProfile } from './library.js';

type LanguageSeed = Omit<LanguageProfile, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * The Hindi pronunciation standard. Written for a model, not a person: it is
 * injected verbatim as the system instruction for the pass that converts a
 * finished script into its spoken form.
 */
const HINDI_SPOKEN = `# Hindi pronunciation standard for AI video / TTS voice generation

You convert Hindi ad copy into a phonetic, stress-marked spelling that an AI
video or speech model performs correctly. Apply these rules to ANY Hindi word,
not only the ones listed.

## 1. Why plain Hinglish text fails

| Failure | Cause | Fix |
|---|---|---|
| Wrong vowel length ("बात" read like "but", not "baat") | Roman \`a\` is ambiguous between अ (short) and आ (long) | Always mark long vowels: \`aa\`, \`ee\`, \`oo\` |
| Flat or foreign stress, worst on numbers and offer words | English TTS applies English stress rules | Mark the stressed syllable in CAPS |
| Over-pronounced words ("करता" as ka-ra-ta, 3 beats, not kar-ta, 2) | Devanagari does not mark that Hindi drops the inherent vowel in speech | Spell the word as SPOKEN, never as Devanagari is structured |

## 2. The encoding system

### 2.1 Vowels — always mark length
अ / inherent → \`a\` (कब → kab) · आ ा → \`aa\` (काम → kaam) · इ ि → \`i\` (दिन → din)
ई ी → \`ee\` (सीट → seet) · उ ु → \`u\` (सुन → sun) · ऊ ू → \`oo\` (दूर → door)
ए े → \`e\` (मेरा → mera) · ऐ ै → \`ai\` (है → hai) · ओ ो → \`o\` (को → ko)
औ ौ → \`au\` (और → aur) · ऑ → \`aw\` (डॉक्टर → DAWK-tar)
Nasal अं ं → trailing \`n\` (रंग → rang, हैं → hain, नहीं → nahin)

If unsure whether a vowel is short or long, say the word slowly: a held sound
doubles the letter. Getting this wrong is the single biggest cause of a model
sounding like it is reading English.

### 2.2 Consonants — never drop aspiration
An aspirated consonant is a different sound from its unaspirated pair, and
models collapse the two when the \`h\` is missing. Always keep it:
क k / ख kh (खर्च → KHARCH) · ग g / घ gh (घर → GHAR) · च ch / छ chh (छूट → CHHOOT)
ज j / झ jh (झूला → JHOO-la) · ट त t / ठ थ th (थैला → THAI-la)
ड द d / ढ ध dh (धन → DHAN) · प p / फ f (फायदा → FAA-y-da) · ब b / भ bh (भाई → BHAAI)

Write फ as \`f\`, not \`ph\`. Spoken Hindi in the ad register realises it as /f/,
and \`f\` renders more reliably.

Do NOT try to encode retroflex vs dental (त/ट, द/ड, न/ण). Models resolve it from
context, and the extra marking collides with CAPS-for-stress.

### 2.3 Schwa deletion — spell as spoken, not as structured
Hindi drops the inherent "a" mid-word even though Devanagari implies it:
ka-ra-na → KAR-na (to do) · ka-ha-te → kah-TE (they say) · mi-la-ga → mi-le-GA (will get)
sa-ma-jha → sam-JHA (understood) · ba-na-i-ye → ba-NAA-i-ye (please make)
Read the word as you would say it in a sentence, then transcribe THAT — never
consonant by consonant from the spelling.

### 2.4 Stress — CAPS on the stressed syllable
- Hyphenate multi-syllable words: kar-TA, pach-CHEES, ha-ZAAR.
- CAPS the one syllable carrying the emphasis. A short word you want stressed
  goes fully capitalised: AAJ, AB.
- Function words (का की के, को, से, में, पर, और, तो, ही) stay lowercase and
  unstressed — capitalising them dilutes the words that matter: price, offer, CTA.
- One clear stress point per phrase. Capitalising everything flattens emphasis
  as badly as capitalising nothing.

### 2.5 One script per sentence
Never mix Devanagari and Latin mid-sentence ("toh देर kis BAAT ki" is wrong —
write "toh DER kis BAAT ki"). You cannot know which rendering path the model
takes for the odd Devanagari word among Latin ones.

### 2.6 English and brand words — decide the accent once, per word
For each loanword or brand name, choose one and keep it for the whole script and
every future script:
- English-accented → leave in plain English spelling (SUV, EMI, ABS as letters).
- Hindi-accented, matching the sentence rhythm → convert like any Hindi word
  (TEST DRAAIV, dis-KAAUNT).
Never spell the same brand two ways in one video.

## 3. Numbers and currency — the highest-stakes lines

### 3.1 Base numbers
1 EK · 2 DO · 3 TEEN · 4 CHAAR · 5 PAANCH · 6 CHHE · 7 SAAT · 8 AATH · 9 NAU · 10 DAS
11 GYAA-rah · 12 BAA-rah · 13 TE-rah · 14 CHAU-dah · 15 PAN-drah · 16 SO-lah
17 SAT-rah · 18 a-THAA-rah · 19 un-NEES · 20 BEES

### 3.2 Tens
20 BEES · 25 pach-CHEES · 30 TEES · 40 CHAA-lees · 50 pa-CHAAS
60 SAATH · 70 SAT-tar · 75 pa-CHAT-tar · 80 AS-see · 90 NAB-be
Hindi 21–99 are irregular, not compositional — say the number aloud and
transcribe that rather than assembling it from parts.

### 3.3 Indian multipliers
Car prices are always spoken in lakh and crore, never as thousands-grouped
numbers. This is the most common mispronunciation in dealer ads.
100 सौ → SAU · 1,000 हज़ार → ha-ZAAR · 1 lakh लाख → LAAKH · 1 crore करोड़ → ka-ROD

Pattern: [number] LAAKH [number] ha-ZAAR ru-PAY-ye
2,25,000 → do LAAKH pach-CHEES ha-ZAAR ru-PAY-ye
8,50,000 → AATH LAAKH pa-CHAAS ha-ZAAR ru-PAY-ye
12,00,000 → BAA-rah LAAKH ru-PAY-ye

### 3.4 Currency and finance
रुपये → ru-PAY-ye · तक → tak · से शुरू → se sha-ROO · प्रति माह → PRA-ti maah
हर महीने → har ma-HEE-ne · डाउन पेमेंट → DAAUN PAY-ment · EMI → leave as letters

## 4. Output checklist
- Every long vowel marked (aa / ee / oo); no ambiguous single vowels.
- Every aspirated consonant keeps its h (kh, gh, chh, jh, th, dh, bh; फ as f).
- No schwa written that is dropped in speech (KAR-na, not ka-ra-na).
- One script per sentence — no Devanagari mixed into Latin.
- Brand and model names spelled identically every time.
- Stress on price and CTA words, not on filler.
- Digits and the ₹ symbol never appear; numbers are always spoken words.`;

const HINDI_WRITTEN = `# Hindi on-screen text rules

STARTING POINT — edit this as you learn what the models render cleanly.

## Default: set on-screen text in English
Speech is Hindi; the cards, footer and end card are English. Every reference
video that reads cleanly does this. English text is what these models render
most reliably, and the viewer hears the Hindi anyway.

## If a card must be in Devanagari
- Keep it under about 25 characters. Long Devanagari strings garble first.
- Avoid stacked conjuncts (क्ष, त्र, ज्ञ, द्ध) where a simpler word exists.
- Keep numerals in Latin digits even inside a Devanagari line — ₹2.25 लाख, not
  २.२५ लाख.
- If a string cannot be rendered accurately, use its English equivalent rather
  than an approximation with the wrong characters.

## Mixed Hindi and English on one card
Allowed, and often best: the number and the English noun carry the meaning.
"₹2.45 लाख तक" above "Cash Discount" reads correctly and is proven.

## Never on screen
- The pronunciation spelling. Nothing with hyphenated syllables or mid-word
  capitals may ever appear as text, a subtitle or a caption — it is for the
  voice only.
- Subtitles of the spoken line. The presenter is on camera; captions compete.

## Load
About one card per ten seconds of video. Models reliably render that many; past
it they start dropping cards silently — the Premier Motors reference lost its
offer card entirely when overloaded.`;

/** Section 4 of the guide, structured so the app can enforce it and grow it. */
const HINDI_GLOSSARY: LanguageProfile['glossary'] = [
  // --- CTA and offer language ---
  { term: 'Test Drive', say: 'TEST DRAAIV', group: 'CTA & offers' },
  { term: 'Book kijiye / Book now', say: 'buk KEE-ji-ye', group: 'CTA & offers' },
  { term: 'Booking', say: 'BUK-ing', group: 'CTA & offers' },
  { term: 'Offer', say: 'AWF-ar', group: 'CTA & offers' },
  { term: 'Discount (English)', say: 'dis-KAAUNT', group: 'CTA & offers' },
  { term: 'Discount (छूट)', say: 'CHHOOT', group: 'CTA & offers' },
  { term: 'Cash Discount', say: 'CASH dis-KAAUNT', group: 'CTA & offers' },
  { term: 'Exchange Bonus', say: 'iks-CHENJ BO-nas', group: 'CTA & offers' },
  { term: 'Finance', say: 'fai-NANS', group: 'CTA & offers' },
  { term: 'Insurance', say: 'in-SHYU-rens', group: 'CTA & offers' },
  { term: 'Limited Period', say: 'li-MI-ted PI-ri-yad', group: 'CTA & offers' },
  { term: 'Aaj hi / today only', say: 'AAJ hi', group: 'CTA & offers' },
  { term: 'Jaldi karen / hurry', say: 'jal-DEE ka-REN', group: 'CTA & offers' },
  { term: 'Visit', say: 'vi-ZIT', group: 'CTA & offers' },
  { term: 'Toh der kis baat ki', say: 'toh DER kis BAAT ki', group: 'CTA & offers' },
  { term: 'Aaiye / come', say: 'AA-i-ye', group: 'CTA & offers' },
  { term: 'Dekhiye / see', say: 'DE-khi-ye', group: 'CTA & offers' },
  { term: 'Jaaniye / know', say: 'JAA-ni-ye', group: 'CTA & offers' },
  { term: 'Samajhiye / understand', say: 'sam-JHI-ye', group: 'CTA & offers' },

  // --- product and showroom ---
  { term: 'Showroom', say: 'SHO-room', group: 'Product & showroom' },
  { term: 'Dealership', say: 'DEE-lar-ship', group: 'Product & showroom' },
  { term: 'Features', say: 'FEE-charz', group: 'Product & showroom' },
  { term: 'Variant', say: 'VE-ri-ant', group: 'Product & showroom' },
  { term: 'Top Model', say: 'TOP MO-dal', group: 'Product & showroom' },
  { term: 'Colour / colours', say: 'KA-lar / KA-larz', group: 'Product & showroom' },
  { term: 'Sedan', say: 'si-DAAN', group: 'Product & showroom' },
  { term: 'Hatchback', say: 'HACH-baik', group: 'Product & showroom' },
  { term: 'SUV', say: 'SUV', note: 'Read as letters — leave in English.', group: 'Product & showroom' },
  { term: 'Mileage', say: 'MAAI-lej', group: 'Product & showroom' },
  { term: 'Warranty', say: 'WAA-ran-tee', group: 'Product & showroom' },
  { term: 'Service', say: 'SAR-vis', group: 'Product & showroom' },
  { term: 'Shaandaar / great', say: 'sha-aan-DAAR', group: 'Product & showroom' },
  { term: 'Faayde / benefits', say: 'FAA-y-de', group: 'Product & showroom' },

  // --- EV ---
  { term: 'Electric Vehicle', say: 'i-LEK-trik VE-hi-kal', group: 'EV' },
  { term: 'EV', say: 'EV', note: 'Read as letters — leave in English.', group: 'EV' },
  { term: 'Battery', say: 'BAI-ta-ree', group: 'EV' },
  { term: 'Range', say: 'RENJ', group: 'EV' },
  { term: 'Charging', say: 'CHAAR-jing', group: 'EV' },
  { term: 'Fast Charging', say: 'FAAST CHAAR-jing', group: 'EV' },
  { term: 'Zero Emission', say: 'ZI-ro i-MI-shan', group: 'EV' },

  // --- launch ---
  { term: 'New Launch', say: 'NYOO LAWNCH', group: 'New launch' },
  { term: 'Pesh hai / introducing', say: 'PESH hai', group: 'New launch' },
  { term: 'Pehli jhalak / first look', say: 'PEH-li jha-LAK', group: 'New launch' },
  { term: 'Ab uplabdh / now available', say: 'ab up-LABDH', group: 'New launch' },

  // --- delivery ---
  { term: 'Delivery', say: 'di-LI-va-ree', group: 'Delivery' },
  { term: 'Handover', say: 'HAND-o-var', group: 'Delivery' },
  { term: 'Badhaai / congratulations', say: 'ba-DHAA-ee', group: 'Delivery' },
  { term: 'Customer', say: 'KAS-ta-mar', group: 'Delivery' },
  { term: 'Aap ki nayi gaadi', say: 'aap kee NA-yee GAA-dee', group: 'Delivery' },

  // --- testimonial ---
  { term: 'Testimonial', say: 'tes-ti-MO-ni-al', group: 'Testimonial' },
  { term: 'Anubhav / experience', say: 'a-nu-BHAV', group: 'Testimonial' },
  { term: 'Santusht / satisfied', say: 'san-TUSHT', group: 'Testimonial' },
  { term: 'Mujhe bahut pasand aayi', say: 'MU-jhe ba-HUT pa-SAND aa-yee', group: 'Testimonial' },

  // --- festival ---
  { term: 'Festival', say: 'FES-ti-val', group: 'Festival' },
  { term: 'Tyohaar', say: 'TYO-haar', group: 'Festival' },
  { term: 'Shubhkamnayein / wishes', say: 'shubh-kaam-NA-yen', group: 'Festival' },
  { term: 'Shubh / auspicious', say: 'SHUBH', group: 'Festival' },

  // --- money ---
  { term: 'Rupaye', say: 'ru-PAY-ye', group: 'Money' },
  { term: 'Lakh', say: 'LAAKH', group: 'Money' },
  { term: 'Hazaar', say: 'ha-ZAAR', group: 'Money' },
  { term: 'Crore', say: 'ka-ROD', group: 'Money' },
  { term: 'Se shuru / starting from', say: 'se sha-ROO', group: 'Money' },
  { term: 'Har maheene / every month', say: 'har ma-HEE-ne', group: 'Money' },
  { term: 'Down payment', say: 'DAAUN PAY-ment', group: 'Money' },
  { term: 'EMI', say: 'EMI', note: 'Read as letters — leave in English.', group: 'Money' },
];

const ENGLISH_WRITTEN = `# English on-screen text rules

- Sentence case for card headlines, not ALL CAPS — caps garble more often and
  read as shouting.
- Under about 40 characters per card. One headline plus at most one sub-line.
- Prices as ₹2.25 Lakh, not ₹225000 — the Indian reader parses lakh instantly.
- Never render the pronunciation spelling of any language as on-screen text.
- About one card per ten seconds of video; past that models drop cards silently.`;

const ENGLISH_SPOKEN = `# English delivery

Indian English, neutral and unhurried, as a showroom presenter speaks it. No
pronunciation respelling is needed — write the line as ordinary English.

- Prices in the Indian system: "two lakh twenty-five thousand", never "two
  hundred twenty-five thousand".
- Read short acronyms as letters: EMI, SUV, ABS, EV. CIBIL is said as a word.
- Split a number from its unit: "45.71 kmpl" is "forty-five point seven one".
- Variant names with (O) are "Optional", never the letter O: "VXi (O)" is
  "V-X-I Optional".`;

export const LANGUAGE_SEEDS: LanguageSeed[] = [
  {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    enabled: true,
    isDefault: true,
    /** Hindi needs the respelling pass; English does not. */
    needsPhonetics: true,
    spokenGuide: HINDI_SPOKEN,
    writtenGuide: HINDI_WRITTEN,
    glossary: HINDI_GLOSSARY,
  },
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    enabled: true,
    needsPhonetics: false,
    spokenGuide: ENGLISH_SPOKEN,
    writtenGuide: ENGLISH_WRITTEN,
    glossary: [],
  },
];
