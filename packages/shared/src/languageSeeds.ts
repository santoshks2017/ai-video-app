/**
 * Starting content for the Languages library.
 *
 * These are seeds, not constants: once a language exists in Firestore the app
 * never reads these again, and the guides are edited in the Languages section.
 * Everything a video model needs to know about how a language is spoken and
 * written lives there, so tuning delivery is an app change, not a code change.
 */

import type { LanguageProfile } from './library.js';
import { REGIONAL_LANGUAGE_SEEDS } from './regionalLanguageSeeds.js';

type LanguageSeed = Omit<LanguageProfile, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * The Hindi pronunciation standard. Written for a model, not a person: it is
 * injected verbatim as the system instruction for the pass that converts a
 * finished script into its spoken form.
 */
const HINDI_SPOKEN = `# Hindi pronunciation standard for AI video / TTS voice generation

You repair the pronunciation of Hindi ad copy for an AI video or speech model.

## 0. RESPELL SPARINGLY — this rule outranks every rule below

Models say most Hindi correctly. Respelling a word that was already fine makes it
WORSE, and respelling everything makes the whole line sound like a foreigner
reading a phrasebook. The line you are given is the default; changing a word is
the exception you have to justify.

Respell a word ONLY if one of these is true:
- It is in the locked-spellings list you are given.
- It is a Hindi word with a real trap: a dropped schwa (करना is karna, not
  karana), a long vowel that changes the word, or a stress that lands wrong.

NUMBERS ARE NEVER RESPELLED. Prices, quantities and units are written in plain
English words — see section 3.

NEVER respell these — leave them exactly as written:
- English words and phrases. Models read "test drive", "showroom", "glass
  facade", "floor", "offer" correctly with English phonology. TEST DRAAIV,
  SHO-room and GLAAS fa-SAAD are all wrong and all sound worse.
- Brand, model, dealership and place names: Tata Punch, Jasper Cars, New Delhi,
  Byte Vanta X. Models know these. TAA-taa PANCH and NYOO DEL-ee are wrong.
- Function words: का की के, को, से, में, पर, और, तो, ही, अपनी, अपना.
- Any number, price, quantity or unit: those are English words, not respellings.
- Any Hindi word you are not confident is mispronounced by default.

Expect to change only a handful of words in a line — often none at all. If you
have respelled more than about a quarter of the words, you have gone too far:
put the rest back.

## 1. Why some Hindi text still fails

| Failure | Cause | Fix |
|---|---|---|
| Wrong vowel length ("बात" read like "but", not "baat") | Roman \`a\` is ambiguous between अ (short) and आ (long) | When you do respell, mark long vowels: \`aa\`, \`ee\`, \`oo\` |
| Over-pronounced words ("करता" as ka-ra-ta, 3 beats, not kar-ta, 2) | Devanagari does not mark that Hindi drops the inherent vowel in speech | Spell the word as SPOKEN, never as Devanagari is structured |

## 2. The encoding system

### 2.1 Vowels — always mark length
अ / inherent → \`a\` (कब → kab) · आ ा → \`aa\` (काम → kaam) · इ ि → \`i\` (दिन → din)
ई ी → \`ee\` (सीट → seet) · उ ु → \`u\` (सुन → sun) · ऊ ू → \`oo\` (दूर → door)
ए े → \`e\` (मेरा → mera) · ऐ ै → \`ai\` (है → hai) · ओ ो → \`o\` (को → ko)
औ ौ → \`au\` (और → aur) · ऑ → \`aw\` (डॉक्टर → dawktar)
Nasal अं ं → trailing \`n\` (रंग → rang, हैं → hain, नहीं → nahin)

If unsure whether a vowel is short or long, say the word slowly: a held sound
doubles the letter. Getting this wrong is the single biggest cause of a model
sounding like it is reading English.

### 2.2 Consonants — never drop aspiration
An aspirated consonant is a different sound from its unaspirated pair, and
models collapse the two when the \`h\` is missing. Always keep it:
क k / ख kh (खर्च → kharch) · ग g / घ gh (घर → ghar) · च ch / छ chh (छूट → chhoot)
ज j / झ jh (झूला → jhoola) · ट त t / ठ थ th (थैला → thaila)
ड द d / ढ ध dh (धन → dhan) · प p / फ f (फायदा → faayda) · ब b / भ bh (भाई → bhaai)

Write फ as \`f\`, not \`ph\`. Spoken Hindi in the ad register realises it as /f/,
and \`f\` renders more reliably.

Do NOT try to encode retroflex vs dental (त/ट, द/ड, न/ण). Models resolve it from
context.

### 2.3 Schwa deletion — spell as spoken, not as structured
Hindi drops the inherent "a" mid-word even though Devanagari implies it:
karana → karna (to do) · kahate → kehte (they say) · milaga → milega (will get)
samajha → samjha (understood) · banaiye → banaaiye (please make)
Read the word as you would say it in a sentence, then transcribe THAT — never
consonant by consonant from the spelling.

### 2.4 Plain words — no capitals, no hyphens
- A respelled word is ONE ordinary lowercase word, the way Hindi is normally
  written in Latin letters: shuru, aaj, kijiye, karna, milega.
- Never split a word into syllables with hyphens, and never mark stress with
  capitals. The video model spells a capitalised word out letter by letter
  (AAJ comes out as A-A-J) and stumbles over syllable breaks, doubling words.
- Capitals only for acronyms said as letters: ABS, EMI, SUV, ADAS, CNG — and
  names already written in capitals, like XUV.
- Everyday words — shuru, aaj, abhi, kijiye, milega, dekhiye — are said
  correctly as they are. Leave them.

### 2.5 The natural line is the base; respellings sit inside it
Keep the sentence as it was written — Devanagari for the Hindi, ordinary English
for the English words and names — and swap in a respelling only for the few words
that need one. A line that is mostly untouched with two words fixed is the goal.
Do NOT convert a whole sentence into Latin phonetics.

### 2.6 English and brand words — leave them in English
The default, and almost always the right answer: write them exactly as they are
normally spelled. Test drive, showroom, offer, EMI, SUV, Tata Punch, Jasper Cars.
Models read these correctly, and respelling them is what makes a line sound
wrong.

The only exception is a specific word you have HEARD the model mispronounce. Add
that one word to the locked-spellings list with its fix, so it is corrected the
same way in every video — and leave every other English word alone.

## 3. Numbers and currency — say them in ENGLISH

Do NOT respell numbers phonetically. "pandrah LAAKH chaar ha-ZAAR" does not work:
models mangle it, and a price is the one line in a car ad that has to land. Write
every number, price and unit in plain English words, in Latin letters, inside the
Devanagari sentence.

  Right: यह automatic variant fifteen lakh four thousand का है।
  Wrong: यह automatic variant pandrah LAAKH chaar ha-ZAAR का है।
  Wrong: यह automatic variant पंद्रह लाख चार हज़ार का है।

Rules:
- Numbers as English words, lower case, no hyphens and no stress capitals:
  "fifteen lakh four thousand", "eight lakh fifty thousand", "twelve lakh".
- Indian scale words stay English too: lakh, crore, thousand, hundred.
- Never digits and never the ₹ symbol — those are read out unpredictably.
- Never say "rupees"; the number alone is how a showroom says a price.
- Units and technical terms stay English as well: kmpl, cc, bhp, Nm, mm, litre,
  airbags, EMI, down payment, on-road price.
  "six airbags", "one ninety three mm ground clearance", "seventy kmpl".
- Ordinary Hindi words around them still follow the rules above: only the
  number and the unit are English.

## 4. Output checklist
- Most of the line came through unchanged. Fewer than a quarter of the words were
  respelled; often none were.
- No English word, brand name, model name or place name was respelled.
- No function word was respelled.
- No capital letters except acronyms said as letters (ABS, EMI, SUV), and no
  hyphens inside a word.
- In the words you DID respell: long vowels marked (aa / ee / oo), aspirated
  consonants keep their h, and no schwa written that is dropped in speech.
- Every number, price and unit is plain English words in Latin letters — no
  phonetic respelling, no digits, no ₹ symbol.`;

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
  { term: 'Test Drive', say: 'test drive', mode: 'english', group: 'CTA & offers' },
  { term: 'Test Ride', say: 'test ride', mode: 'english', group: 'CTA & offers' },
  { term: 'Book kijiye / Book now', say: 'book kijiye', group: 'CTA & offers' },
  { term: 'Booking', say: 'booking', mode: 'english', group: 'CTA & offers' },
  { term: 'Offer', say: 'offer', mode: 'english', group: 'CTA & offers' },
  { term: 'Discount (English)', say: 'discount', mode: 'english', group: 'CTA & offers' },
  { term: 'Discount (छूट)', say: 'chhoot', group: 'CTA & offers' },
  { term: 'Cash Discount', say: 'cash discount', mode: 'english', group: 'CTA & offers' },
  { term: 'Exchange Bonus', say: 'exchange bonus', mode: 'english', group: 'CTA & offers' },
  { term: 'Finance', say: 'finance', mode: 'english', group: 'CTA & offers' },
  { term: 'Insurance', say: 'insurance', mode: 'english', group: 'CTA & offers' },
  { term: 'Limited Period', say: 'limited period', mode: 'english', group: 'CTA & offers' },
  { term: 'Aaj hi / today only', say: 'aaj hi', group: 'CTA & offers' },
  { term: 'Jaldi karen / hurry', say: 'jaldi karen', group: 'CTA & offers' },
  { term: 'Visit', say: 'visit', mode: 'english', group: 'CTA & offers' },
  { term: 'Toh der kis baat ki', say: 'toh der kis baat ki', group: 'CTA & offers' },
  { term: 'Aaiye / come', say: 'aaiye', group: 'CTA & offers' },
  { term: 'Dekhiye / see', say: 'dekhiye', group: 'CTA & offers' },
  { term: 'Jaaniye / know', say: 'jaaniye', group: 'CTA & offers' },
  { term: 'Samajhiye / understand', say: 'samjhiye', group: 'CTA & offers' },

  // --- product and showroom ---
  { term: 'Showroom', say: 'showroom', mode: 'english', group: 'Product & showroom' },
  { term: 'Dealership', say: 'dealership', mode: 'english', group: 'Product & showroom' },
  { term: 'Features', say: 'features', mode: 'english', group: 'Product & showroom' },
  { term: 'Variant', say: 'variant', mode: 'english', group: 'Product & showroom' },
  { term: 'Top Model', say: 'top model', mode: 'english', group: 'Product & showroom' },
  { term: 'Colour / colours', say: 'colour / colours', mode: 'english', group: 'Product & showroom' },
  { term: 'Sedan', say: 'sedan', mode: 'english', group: 'Product & showroom' },
  { term: 'Hatchback', say: 'hatchback', mode: 'english', group: 'Product & showroom' },
  { term: 'SUV', say: 'SUV', mode: 'english', note: 'Read as letters.', group: 'Product & showroom' },
  { term: 'Mileage', say: 'mileage', mode: 'english', group: 'Product & showroom' },
  { term: 'Warranty', say: 'warranty', mode: 'english', group: 'Product & showroom' },
  { term: 'Service', say: 'service', mode: 'english', group: 'Product & showroom' },
  { term: 'Shaandaar / great', say: 'shaandaar', group: 'Product & showroom' },
  { term: 'Faayde / benefits', say: 'faayde', group: 'Product & showroom' },

  // --- EV ---
  { term: 'Electric Vehicle', say: 'electric vehicle', mode: 'english', group: 'EV' },
  { term: 'EV', say: 'EV', mode: 'english', note: 'Read as letters.', group: 'EV' },
  { term: 'Battery', say: 'battery', mode: 'english', group: 'EV' },
  { term: 'Range', say: 'range', mode: 'english', group: 'EV' },
  { term: 'Charging', say: 'charging', mode: 'english', group: 'EV' },
  { term: 'Fast Charging', say: 'fast charging', mode: 'english', group: 'EV' },
  { term: 'Zero Emission', say: 'zero emission', mode: 'english', group: 'EV' },

  // --- launch ---
  { term: 'New Launch', say: 'new launch', mode: 'english', group: 'New launch' },
  { term: 'Pesh hai / introducing', say: 'pesh hai', group: 'New launch' },
  { term: 'Pehli jhalak / first look', say: 'pehli jhalak', group: 'New launch' },
  { term: 'Ab uplabdh / now available', say: 'ab uplabdh', group: 'New launch' },

  // --- delivery ---
  { term: 'Delivery', say: 'delivery', mode: 'english', group: 'Delivery' },
  { term: 'Handover', say: 'handover', mode: 'english', group: 'Delivery' },
  { term: 'Badhaai / congratulations', say: 'badhaai', group: 'Delivery' },
  { term: 'Customer', say: 'customer', mode: 'english', group: 'Delivery' },
  { term: 'Aap ki nayi gaadi', say: 'aap ki nayi gaadi', group: 'Delivery' },

  // --- testimonial ---
  { term: 'Testimonial', say: 'testimonial', mode: 'english', group: 'Testimonial' },
  { term: 'Anubhav / experience', say: 'anubhav', group: 'Testimonial' },
  { term: 'Santusht / satisfied', say: 'santusht', group: 'Testimonial' },
  { term: 'Mujhe bahut pasand aayi', say: 'mujhe bahut pasand aayi', group: 'Testimonial' },

  // --- festival ---
  { term: 'Festival', say: 'festival', mode: 'english', group: 'Festival' },
  { term: 'Tyohaar', say: 'tyohaar', group: 'Festival' },
  { term: 'Shubhkamnayein / wishes', say: 'shubhkaamnayein', group: 'Festival' },
  { term: 'Shubh / auspicious', say: 'shubh', group: 'Festival' },

  // --- money ---
  { term: 'Rupaye', say: 'rupaye', mode: 'english', note: 'Numbers stay English.', group: 'Money' },
  { term: 'Lakh', say: 'lakh', mode: 'english', note: 'Numbers stay English.', group: 'Money' },
  { term: 'Hazaar', say: 'thousand', mode: 'english', note: 'Numbers stay English.', group: 'Money' },
  { term: 'Crore', say: 'crore', mode: 'english', note: 'Numbers stay English.', group: 'Money' },
  { term: 'Se shuru / starting from', say: 'se shuru', group: 'Money' },
  { term: 'Har maheene / every month', say: 'har maheene', group: 'Money' },
  { term: 'Down payment', say: 'down payment', mode: 'english', group: 'Money' },
  { term: 'EMI', say: 'EMI', mode: 'english', note: 'Read as letters.', group: 'Money' },
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
  ...REGIONAL_LANGUAGE_SEEDS,
];
