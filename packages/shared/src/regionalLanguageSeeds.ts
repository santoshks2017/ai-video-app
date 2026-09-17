/**
 * Eight more Indian languages for the Languages library: Assamese, Bengali, Kannada,
 * Malayalam, Marathi, Punjabi, Tamil and Telugu.
 *
 * Adapted from the team's pronunciation guides (September 2026) to the conventions the
 * Hindi guide settled on in production: respell sparingly, a respelled word is one plain
 * lowercase word with no stress capitals and no syllable hyphens, and numbers are plain
 * English words. The guides' capital L for the retroflex l is dropped for the same
 * reason — a capital is spelled out letter by letter — so a word with that letter stays
 * in its own script, which already carries the sound.
 *
 * The translated ad phrases in each glossary come from those guides and are a starting
 * point: a native speaker should confirm them before they are relied on at scale.
 */
import type { LanguageProfile } from './library.js';

type LanguageSeed = Omit<LanguageProfile, 'id' | 'createdAt' | 'updatedAt'>;
type Glossary = LanguageProfile['glossary'];

interface Guide {
  name: string;
  nativeName: string;
  code: string;
  /** The script the language is written in, as a sentence names it. */
  script: string;
  /** The traps that justify a respelling, for section 0. */
  traps: string;
  functionWords: string;
  different: string;
  vowels: string;
  consonants: string;
  spoken: string;
  /** "Up to", in the language — what a price line hangs its English number on. */
  upTo: string;
  gender: string;
  checks: string[];
  /** What to watch for when a card is set in the script. */
  cardNote: string;
  phrases: Phrase[];
}

/** [in the script, what it means, how it is said, note?, handled in English?] */
type Phrase = [string, string, string, string?, boolean?];

function spokenGuide(g: Guide): string {
  return `# ${g.name} pronunciation standard for AI video / TTS voice generation

You repair the pronunciation of ${g.name} ad copy for an AI video or speech model.

## 0. RESPELL SPARINGLY — this rule outranks every rule below

Models say most ${g.name} correctly. Respelling a word that was already fine makes it
worse, and respelling everything makes the whole line sound like a foreigner reading a
phrasebook. The line you are given is the default; changing a word is the exception you
have to justify.

Respell a word ONLY if one of these is true:
- It is in the locked-spellings list you are given.
- It is a ${g.name} word with a real trap: ${g.traps}.

NUMBERS ARE NEVER RESPELLED. Prices, quantities and units are written in plain English
words — see section 3.

NEVER respell these — leave them exactly as written:
- English words and phrases: test drive, showroom, offer, EMI, down payment. Models read
  them correctly with English phonology.
- Brand, model, dealership and place names. Models know these.
- Function words: ${g.functionWords}.
- Any number, price, quantity or unit.
- Any ${g.name} word you are not confident is mispronounced by default.

Expect to change only a handful of words in a line — often none at all. If you have
respelled more than about a quarter of the words, you have gone too far: put the rest back.

## 1. What is different about ${g.name}

${g.different}

## 2. The encoding system — for the few words you do respell

### 2.1 Vowels
${g.vowels}

### 2.2 Consonants
${g.consonants}

### 2.3 Spell it as spoken
${g.spoken}

### 2.4 Plain words — no capitals, no hyphens
- A respelled word is ONE ordinary lowercase word in Latin letters.
- Never split a word into syllables with hyphens, and never mark stress with capitals. The
  video model spells a capitalised word out letter by letter and stumbles over syllable
  breaks, doubling words.
- Capitals only for acronyms said as letters — ABS, EMI, SUV, ADAS, CNG — and names already
  written in capitals, like XUV.

### 2.5 The natural line is the base; respellings sit inside it
Keep the sentence as it was written — ${g.script} for the ${g.name}, ordinary English for the
English words and names — and swap in a respelling only for the few words that need one.
Do NOT convert a whole sentence into Latin phonetics.

### 2.6 English and brand words — leave them in English
Write them exactly as they are normally spelled. The only exception is a specific word you
have HEARD the model mispronounce: add that one word to the locked-spellings list with its
fix, so it is corrected the same way in every video.

## 3. Numbers and currency — say them in ENGLISH

Write every number, price and unit in plain English words, in Latin letters, inside the
${g.script} sentence. Only the words around the number are ${g.name}.

  Right: two lakh twenty five thousand ${g.upTo}
  Wrong: the number respelled phonetically, written in ${g.name}, or written as digits

- Numbers as English words, lower case, no hyphens and no stress capitals.
- Indian scale words stay English — lakh, crore, thousand, hundred — never the ${g.name} words for them.
- Never digits and never the ₹ symbol. Never say "rupees".
- Decimals with "point": forty two point eight. Percentages in full: eight point nine nine percent.
- Units and technical terms stay English: kmpl, cc, bhp, airbags, EMI, on-road price.
- "(O)" in a variant name is said "optional". Acronyms are said as letters: EMI, ABS. CIBIL is said as a word.

## 4. Presenter gender
${g.gender}

## 5. Output checklist
- Most of the line came through unchanged. Fewer than a quarter of the words were respelled; often none were.
- No English word, brand name, model name or place name was respelled.
- No capital letters except acronyms said as letters, and no hyphens inside a word.
${g.checks.map((c) => `- ${c}`).join('\n')}
- Every number, price and unit is plain English words in Latin letters — no phonetic respelling, no digits, no ₹ symbol.
- A new or uncertain phrase goes into the locked spellings only once a native ${g.name} speaker has confirmed it.`;
}

function writtenGuide(g: Guide): string {
  return `# ${g.name} on-screen text rules

STARTING POINT — edit this as you learn what renders cleanly.

## Default: set on-screen text in English
Speech is ${g.name}; the cards, footer and end card are English. English is what renders most
reliably, and the viewer hears the ${g.name} anyway.

## If a card must be in ${g.script}
- Keep it under about 25 characters. Long strings garble first.
- ${g.cardNote}
- Keep numerals in Latin digits even inside a ${g.script} line — ₹2.25 lakh, never ${g.name} numerals.
- If a string cannot be written accurately, use its English equivalent rather than an approximation.

## Mixed ${g.name} and English on one card
Allowed, and often best: the number and the English noun carry the meaning.

## Never on screen
- The pronunciation spelling. Respellings are for the voice only — never text, a subtitle or a caption.
- Subtitles of the spoken line. The presenter is on camera; captions compete.

## Load
About one card per ten seconds of video. Past that, cards start to be dropped.`;
}

/** The English words every Indian dealership film says in English, whatever the language. */
const ENGLISH_TERMS: Glossary = [
  { term: 'Test Drive', say: 'test drive', mode: 'english', group: 'CTA & offers' },
  { term: 'Test Ride', say: 'test ride', mode: 'english', group: 'CTA & offers' },
  { term: 'Booking', say: 'booking', mode: 'english', group: 'CTA & offers' },
  { term: 'Offer', say: 'offer', mode: 'english', group: 'CTA & offers' },
  { term: 'Discount (English)', say: 'discount', mode: 'english', group: 'CTA & offers' },
  { term: 'Exchange Bonus', say: 'exchange bonus', mode: 'english', group: 'CTA & offers' },
  { term: 'Finance', say: 'finance', mode: 'english', group: 'CTA & offers' },
  { term: 'Showroom', say: 'showroom', mode: 'english', group: 'Product & showroom' },
  { term: 'Variant', say: 'variant', mode: 'english', group: 'Product & showroom' },
  { term: 'SUV', say: 'SUV', mode: 'english', note: 'Read as letters.', group: 'Product & showroom' },
  { term: 'Lakh', say: 'lakh', mode: 'english', note: 'Numbers stay English.', group: 'Money' },
  { term: 'Crore', say: 'crore', mode: 'english', note: 'Numbers stay English.', group: 'Money' },
  { term: 'Thousand', say: 'thousand', mode: 'english', note: 'Numbers stay English.', group: 'Money' },
  { term: 'Down payment', say: 'down payment', mode: 'english', group: 'Money' },
  { term: 'EMI', say: 'EMI', mode: 'english', note: 'Read as letters.', group: 'Money' },
];

function glossary(phrases: Phrase[]): Glossary {
  const native: Glossary = phrases.map(([written, meaning, say, note, english]) => ({
    term: `${written} / ${meaning}`,
    say,
    ...(english ? { mode: 'english' as const } : {}),
    ...(note ? { note } : {}),
    group: /congratulations|new car/i.test(meaning) ? 'Delivery' : 'CTA & offers',
  }));
  return [...native, ...ENGLISH_TERMS];
}

const seed = (g: Guide): LanguageSeed => ({
  code: g.code,
  name: g.name,
  nativeName: g.nativeName,
  enabled: true,
  needsPhonetics: true,
  spokenGuide: spokenGuide(g),
  writtenGuide: writtenGuide(g),
  glossary: glossary(g.phrases),
});

const RETROFLEX_L = (letter: string, example: string, script: string): string =>
  `- It has the retroflex ${letter} (${example} uses it). Leave a word with ${letter} in ${script} rather than respelling it: the script already carries the sound. If one must be respelled, write l — never a capital L, which is spelled out letter by letter.`;

const BENGALI: Guide = {
  name: 'Bengali',
  nativeName: 'বাংলা',
  code: 'bn',
  script: 'Bengali script',
  traps: 'the inherent vowel read as "a" instead of "o" (বল is bol, not bal), or a long আ that changes the word',
  functionWords: 'এবং, আর, ও, এর, কে, থেকে, তে',
  different: [
    '- The inherent vowel is "o", not "a". A bare Bengali consonant carries an "o" sound — কলকাতা is Kolkata, not Kalakata. Written with Hindi habits, a large share of Bengali words come out with the wrong vowel. Always write the vowel you actually hear: বল is bol, মন is mon, কর is kor. Check this first; it is the one that breaks silently.',
    '- Short and long i and u sound the same in speech: ই and ঈ are one sound, as are উ and ঊ, so doubling i or u changes nothing. The long আ still matters — write it aa.',
    '- Aspiration works as in Hindi: খ kh, ঘ gh, ছ chh, ঝ jh, থ th, ধ dh, ভ bh. Never drop the h. Write ফ as f.',
    '- Retroflex and dental are not encoded; context carries them.',
  ].join('\n'),
  vowels: 'অ / inherent → o (বল → bol) · আ া → aa (কাজ → kaaj) · ই ঈ → i · উ ঊ → u\nএ → e (কেন → keno) · ঐ → oi · ও → o · ঔ → ou · ং → trailing ng (রং → rong)',
  consonants: 'খ kh · ঘ gh · ছ chh · ঝ jh · থ th · ধ dh · ফ f · ভ bh — keep the h on every aspirated consonant.\nDo not try to encode retroflex against dental.',
  spoken: 'Write the word as it is said, remembering the base vowel is o: করছি is said korchi — not karachi, and not karchi.',
  upTo: 'পর্যন্ত',
  gender: 'Bengali verbs do not change with gender: করছি is the same whether the presenter is a man or a woman. Nothing to lock — choose the natural phrasing.',
  checks: ['In the words you did respell: the inherent vowel is o, not a; long আ is aa; aspirated consonants keep their h.'],
  cardNote: 'Bengali conjuncts (ক্ষ, ত্র, জ্ঞ) garble first — use a simpler word where one exists.',
  phrases: [
    ['এখনই বুক করুন', 'book now', 'ekhonoi book korun'],
    ['আজই', 'today only', 'aajoi'],
    ['আসুন', 'please come', 'aashun'],
    ['দেখুন', 'please see', 'dekhun'],
    ['অভিনন্দন', 'congratulations', 'obhinandon'],
    ['দারুণ', 'wonderful', 'daarun'],
    ['ছাড়', 'discount', 'chhaar', 'Genuinely common in Bengali ads — use it rather than defaulting to "discount".'],
    ['আপনার নতুন গাড়ি', 'your new car', 'aapnaar notun gaari'],
    ['তাড়াতাড়ি করুন', 'hurry up', 'taaraataari korun'],
    ['আমাদের কাছে আসুন', 'visit us', 'aamaader kaache aashun'],
  ],
};

const ASSAMESE: Guide = {
  name: 'Assamese',
  nativeName: 'অসমীয়া',
  code: 'as',
  script: 'Assamese script',
  traps: 'শ, ষ and স all said as x (অসম is oxom, not asam), চ and ছ said as s, জ and ঝ as z',
  functionWords: 'আৰু, ৰ, ক, লৈ, পৰা, ত',
  different: [
    '- শ, ষ and স are all said as x — the sound in Scottish "loch", never an s. অসম is oxom, সোনকালে is xonkale. Check this one first: a writer carrying Hindi or Bengali habits leaves an s in every one of them, and the whole line sounds foreign.',
    '- চ and ছ are said as s, and জ and ঝ as z. চাওক is saok, আজি is azi.',
    '- The inherent vowel is o, not a: ৰং is rong, মন is mon.',
    '- Assamese writes ৰ and ৱ where Bengali writes র and ব. A line pasted from Bengali carries the wrong letter and reads as a typo on screen.',
    '- Retroflex and dental are not distinguished in speech; context carries them. Aspiration still matters: খ kh, ঘ gh, থ th, ধ dh, ভ bh — never drop the h.',
  ].join('\n'),
  vowels:
    'অ / inherent → o (ৰং → rong) · আ া → aa (কাম → kaam) · ই ঈ → i · উ ঊ → u\nএ → e (কেনে → kene) · ঐ → oi · ও → o · ঔ → ou · ং → trailing ng',
  consonants:
    'শ ষ স → x (অসম → oxom) · চ ছ → s · জ ঝ → z · খ kh · ঘ gh · থ th · ধ dh · ফ f · ভ bh\nৰ is r and ৱ is w — the two letters Assamese does not share with Bengali.',
  spoken:
    'Write the word as it is said, remembering স is x and চ is s: অসমত is said oxomot — not asamat, and not asomot.',
  upTo: 'পৰ্যন্ত',
  gender:
    'Assamese verbs do not change with gender: কৰিছোঁ is the same whether the presenter is a man or a woman. Nothing to lock — choose the natural phrasing.',
  checks: [
    'In the words you did respell: শ/ষ/স are x, চ/ছ are s, জ/ঝ are z, and the inherent vowel is o, not a.',
  ],
  cardNote:
    'ৰ and ৱ are the letters a Bengali font or a copy-paste gets wrong — check both on every card. Conjuncts (ক্ষ, ত্ৰ, জ্ঞ) garble first; use a simpler word where one exists.',
  phrases: [
    ['এতিয়াই বুক কৰক', 'book now', 'etiyai book korok'],
    ['আজিয়েই', 'today only', 'aziyei'],
    ['আহক', 'please come', 'ahok'],
    ['চাওক', 'please see', 'saok'],
    ['অভিনন্দন', 'congratulations', 'obhinondon'],
    ['ধুনীয়া', 'beautiful', 'dhuniya'],
    ['ৰেহাই', 'discount', 'rehai', 'Assamese ads often just say "discount" in English — use whichever the copy already uses.'],
    ['আপোনাৰ নতুন গাড়ী', 'your new car', 'aponar notun gari'],
    ['সোনকালে কৰক', 'hurry up', 'xonkale korok'],
    ['আমাৰ ওচৰলৈ আহক', 'visit us', 'amar osorloi ahok'],
  ],
};

const KANNADA: Guide = {
  name: 'Kannada',
  nativeName: 'ಕನ್ನಡ',
  code: 'kn',
  script: 'Kannada script',
  traps: 'a long vowel that changes the word — including the long ಏ and ಓ — or a dropped aspiration',
  functionWords: 'ಮತ್ತು, ಗೆ, ಅಲ್ಲಿ, ಇಂದ, ಅನ್ನು',
  different: [
    '- Aspiration works as in Hindi. The full aspirated series is in use — ಖ kh, ಘ gh, ಛ chh, ಝ jh, ಥ th, ಧ dh, ಫ f, ಭ bh. Never drop the h.',
    '- Short and long e and o are different sounds: ಎ / ಏ and ಒ / ಓ. Hindi does not make this distinction; Kannada does.',
    RETROFLEX_L('ಳ', 'ಬೆಂಗಳೂರು', 'Kannada script'),
    '- Retroflex and dental are not encoded; context carries them.',
  ].join('\n'),
  vowels: 'ಅ → a · ಆ → aa · ಇ → i · ಈ → ee · ಉ → u · ಊ → oo\nಎ → e · ಏ → ea (long, kept apart from short e) · ಐ → ai · ಒ → o · ಓ → oa (long, kept apart from short o) · ಔ → au · ಂ → trailing n or ng',
  consonants: 'kh, gh, chh, jh, th, dh, f, bh — keep the h on every aspirated consonant, and write ಫ as f. ಳ is written l if it must be respelled.',
  spoken: 'Write the casual spoken form an ad would use, not formal or literary Kannada.',
  upTo: 'ವರೆಗೆ',
  gender: 'First-person verbs are largely the same for a man and a woman — ನಾನು ತೋರಿಸ್ತೀನಿ (I will show) does not change. Gender only matters when a line describes someone else.',
  checks: [
    'In the words you did respell: long vowels marked, including ea and oa for the long e and o; aspirated consonants keep their h.',
    'Casual spoken Kannada, not the formal written form.',
  ],
  cardNote: 'Avoid long stacked consonant clusters where a simpler word exists.',
  phrases: [
    ['ಈಗಲೇ ಬುಕ್ ಮಾಡಿ', 'book now', 'eegalea book maadi'],
    ['ಇಂದೇ', 'today only', 'indea'],
    ['ಬನ್ನಿ', 'please come', 'banni'],
    ['ನೋಡಿ', 'please see', 'noadi'],
    ['ಅಭಿನಂದನೆಗಳು', 'congratulations', 'abhinandanegalu'],
    ['ಸೂಪರ್', 'great', 'super', 'English loanword, common in casual ads.', true],
    ['ರಿಯಾಯಿತಿ', 'discount', 'riyaayithi'],
    ['ನಿಮ್ಮ ಹೊಸ ಕಾರು', 'your new car', 'nimma hosa kaaru'],
    ['ಬೇಗ ಬನ್ನಿ', 'hurry up', 'beaga banni'],
    ['ನಮ್ಮ ಬಳಿಗೆ ಬನ್ನಿ', 'visit us', 'namma balige banni'],
  ],
};

const MALAYALAM: Guide = {
  name: 'Malayalam',
  nativeName: 'മലയാളം',
  code: 'ml',
  script: 'Malayalam script',
  traps: 'a long vowel that changes the word — including the long ഏ and ഓ — or a dropped aspiration',
  functionWords: 'ഉം, ക്ക്, ൽ, ന്റെ, ആണ്',
  different: [
    '- Aspiration works as in Hindi — ഖ kh, ഘ gh, ഛ chh, ഝ jh, ഥ th, ധ dh, ഫ f, ഭ bh. Never drop the h.',
    '- Short and long e and o are different sounds: എ / ഏ and ഒ / ഓ.',
    RETROFLEX_L('ള', 'കേരളം', 'Malayalam script'),
    '- The chillu letters (ൽ ൾ ൺ ൻ ർ) are consonants that end a word with no vowel after them. Nothing to mark: a respelling that ends on the consonant already says it — മലയാളം is malayaalam.',
    '- Retroflex and dental are not encoded; context carries them.',
  ].join('\n'),
  vowels: 'അ → a · ആ → aa · ഇ → i · ഈ → ee · ഉ → u · ഊ → oo\nഎ → e · ഏ → ea (long) · ഐ → ai · ഒ → o · ഓ → oa (long) · ഔ → au · ം → trailing n or ng',
  consonants: 'kh, gh, chh, jh, th, dh, f, bh — keep the h, and write ഫ as f. ള is written l if it must be respelled. A word-final chillu is simply the last consonant of the respelling.',
  spoken: 'Write the casual spoken form an ad would use, not formal or literary Malayalam.',
  upTo: 'വരെ',
  gender: 'Malayalam verbs do not change with gender. Nothing to lock — choose the natural phrasing.',
  checks: [
    'In the words you did respell: long vowels marked, including ea and oa; aspirated consonants keep their h; a word-final chillu is just the last consonant.',
    'Casual spoken Malayalam, not the formal written form.',
  ],
  cardNote: 'Malayalam conjuncts can garble — keep cards short and prefer simpler words.',
  phrases: [
    ['ഇപ്പോൾ തന്നെ ബുക്ക് ചെയ്യൂ', 'book now', 'ippoal thanne book cheyyoo'],
    ['ഇന്ന് തന്നെ', 'today only', 'innu thanne'],
    ['വരൂ', 'please come', 'varoo'],
    ['നോക്കൂ', 'please see', 'noakkoo'],
    ['അഭിനന്ദനങ്ങൾ', 'congratulations', 'abhinandanangal'],
    ['സൂപ്പർ', 'great', 'super', 'English loanword, common in casual ads.', true],
    ['വിലക്കുറവ്', 'discount', 'vilakkuravu'],
    ['നിങ്ങളുടെ പുതിയ കാർ', 'your new car', 'ningalude puthiya kaar'],
    ['വേഗം വരൂ', 'hurry up', 'veagam varoo'],
    ['ഞങ്ങളെ സന്ദർശിക്കൂ', 'visit us', 'nyangale sandarshikkoo'],
  ],
};

const MARATHI: Guide = {
  name: 'Marathi',
  nativeName: 'मराठी',
  code: 'mr',
  script: 'Devanagari',
  traps: 'a dropped schwa (करतो is karto, not karato), or a long vowel that changes the word',
  functionWords: 'आणि, ला, चा, ची, चे, ने, मध्ये, वर',
  different: [
    "- Three grammatical genders, not two — masculine, feminine and neuter. Verb and adjective endings follow the gender, which matters for the presenter's lines (section 4).",
    '- Marathi has ळ, a retroflex l that standard Hindi lacks (फळ, वेळ). Leave a word with ळ in Devanagari rather than respelling it — the script carries the sound, and a plain l would flatten it. Never write it as a capital L, which is spelled out letter by letter.',
    '- Two vowels for English loanwords: ॲ (the a in "cat", as in ॲक्सेसरीज) and ऑ (as in ऑफर). These mostly sit inside English words, which stay in English anyway.',
    '- Everything else — vowel length, aspiration, dropped schwas — works as in Hindi.',
  ].join('\n'),
  vowels: 'Same as Hindi: अ → a · आ → aa · इ → i · ई → ee · उ → u · ऊ → oo · ए → e · ऐ → ai · ओ → o · औ → au · nasal → trailing n\nॲ → a (the English "cat" vowel) · ऑ → aw (ऑफर → awfar)',
  consonants: 'Aspiration as in Hindi — kh, gh, chh, jh, th, dh, f, bh; never drop the h, and write फ as f. Do not encode retroflex against dental. ळ stays in Devanagari.',
  spoken: 'Marathi drops the inherent vowel mid-word as Hindi does: करतो is said karto, not karato. Transcribe the word as you would say it in a sentence.',
  upTo: 'पर्यंत',
  gender: [
    "Lock the presenter's gender once and hold the matching endings throughout. Marathi's are its own — -to for a man, -te for a woman, not Hindi's -ta and -ti:",
    '- A woman presenting: करते (karte), देते (dete), सांगते (saangte)',
    '- A man presenting: करतो (karto), देतो (deto), सांगतो (saangto)',
    'The neuter form is never used for a person.',
  ].join('\n'),
  checks: [
    'In the words you did respell: long vowels marked, aspirated consonants keep their h, and no schwa written that is dropped in speech.',
    "The presenter's verb endings match their gender all the way through.",
  ],
  cardNote: 'Avoid stacked conjuncts (क्ष, त्र, ज्ञ) where a simpler word exists.',
  phrases: [
    ['लगेच बुक करा', 'book now', 'lagech book kara'],
    ['आजच', 'today only', 'aajach'],
    ['या', 'please come', 'yaa'],
    ['बघा', 'please see', 'baghaa'],
    ['अभिनंदन', 'congratulations', 'abhinandan'],
    ['जबरदस्त', 'great', 'jabardast'],
    ['सवलत', 'discount', 'savlat'],
    ['तुमची नवी गाडी', 'your new car', 'tumchee navee gaadee'],
    ['लगेच या', 'hurry up', 'lagech yaa'],
    ['भेट द्या', 'visit us', 'bhet dyaa'],
  ],
};

const PUNJABI: Guide = {
  name: 'Punjabi',
  nativeName: 'ਪੰਜਾਬੀ',
  code: 'pa',
  script: 'Gurmukhi',
  traps: 'a long vowel that changes the word, or a schwa written that is dropped in speech',
  functionWords: 'ਅਤੇ, ਦਾ, ਦੀ, ਦੇ, ਨੂੰ, ਤੋਂ, ਵਿੱਚ',
  different: [
    '- Punjabi is tonal; Hindi is not. Much of the old voiced aspiration (gh, dh, bh, jh) moved into the pitch of the next vowel — a word-initial gh often sounds as a plain g with a falling tone. There is no plain-letter way to mark tone that a model reads reliably, so do not invent tone marks.',
    '- Keep writing these consonants with their usual spelling, h included (ਘਰ ghar, ਵਧਾਈਆਂ vadhaaiyaan): Punjabi-trained models apply the tone from the ordinary spelling. Better still, leave tone-sensitive words in Gurmukhi.',
    '- Tone errors are invisible on paper and obvious when heard. Listen to a few generated Punjabi clips before trusting the locked spellings at scale.',
    '- Everything else works as in Hindi.',
  ].join('\n'),
  vowels: 'Same as Hindi: a, aa, i, ee, u, oo, e, ai, o, au. Nasalisation → trailing n (ਨਹੀਂ → nahin, ਹੈਂ → hain).',
  consonants: 'kh, gh, chh, jh, th, dh, f, bh — keep the h, which the model turns into the tone, and write ਫ as f. Do not encode retroflex against dental.',
  spoken: 'Spell words as they are spoken, not as the script is structured — a schwa that is dropped in speech is not written.',
  upTo: 'ਤੱਕ',
  gender: "Punjabi verbs agree with gender as Hindi's do. Lock the presenter's gender once and hold the endings throughout: ਕਰਦੀ ਹਾਂ (kardi haan) for a woman, ਕਰਦਾ ਹਾਂ (karda haan) for a man.",
  checks: [
    'In the words you did respell: long vowels marked and aspirated consonants keep their h.',
    "The presenter's verb endings match their gender all the way through.",
    'Tone-sensitive words were checked against generated audio, not only read on paper.',
  ],
  cardNote: 'Keep Gurmukhi cards short; long strings garble first.',
  phrases: [
    ['ਹੁਣੇ ਬੁੱਕ ਕਰੋ', 'book now', 'hune book karo'],
    ['ਅੱਜ ਹੀ', 'today only', 'ajj hi'],
    ['ਆਓ', 'please come', 'aao'],
    ['ਦੇਖੋ', 'please see', 'dekho'],
    ['ਵਧਾਈਆਂ', 'congratulations', 'vadhaaiyaan', 'Tone-sensitive — check it in generated audio.'],
    ['ਸ਼ਾਨਦਾਰ', 'great', 'shaandaar'],
    ['ਛੋਟ', 'discount', 'chhot'],
    ['ਤੁਹਾਡੀ ਨਵੀਂ ਗੱਡੀ', 'your new car', 'tuhaadee naveen gaddee'],
    ['ਜਲਦੀ ਕਰੋ', 'hurry up', 'jaldee karo'],
    ['ਸਾਡੇ ਕੋਲ ਆਓ', 'visit us', 'saade kol aao'],
  ],
};

const TAMIL: Guide = {
  name: 'Tamil',
  nativeName: 'தமிழ்',
  code: 'ta',
  script: 'Tamil script',
  traps: 'a long vowel that changes the word — including the long ஏ and ஓ — ழ read as a plain l, or a formal written form where speech uses the casual one',
  functionWords: 'மற்றும், இல், உம், க்கு',
  different: [
    '- Tamil is Dravidian. Native Tamil words do not contrast aspirated and unaspirated consonants the way Hindi does — one letter like க covers related sounds by its position. Write the sound you hear; no aspiration marking for native Tamil words.',
    '- ழ is a sound of its own, between an American "r" and an "l". Write it zh: தமிழ் is thamizh.',
    '- Of the three n sounds, write ங as ng (the n in "sing"); leave ன and ண as n.',
    '- Short and long e and o are different sounds: எ / ஏ and ஒ / ஓ.',
    '- Tamil ad speech code-switches into English more than Hindi ad speech does. Test drive, discount, EMI and showroom are ordinary Tamil ad speech in English — never force a Tamil spelling on a word the register says in English.',
    '- Spoken Tamil is not written Tamil: formal வாருங்கள் is casual வாங்க (vaanga). Use the casual form an ad would use.',
  ].join('\n'),
  vowels: 'அ → a · ஆ → aa · இ → i · ஈ → ee · உ → u · ஊ → oo\nஎ → e · ஏ → ea (long — வேலை is vealai) · ஐ → ai · ஒ → o · ஓ → oa (long) · ஔ → au',
  consonants: 'No aspiration marking for native Tamil words — write what you hear. ழ → zh. ங → ng. ன and ண → n. English-only sounds in loanwords (f, sh, z, j) are written as heard: ஃபோன் → foan.',
  spoken: 'Write the casual spoken form, not formal or literary Tamil.',
  upTo: 'வரை',
  gender: 'First-person verbs are the same for a man and a woman — நான் காட்டுறேன் (I will show) does not change. Gender only matters when a line describes someone else.',
  checks: [
    'In the words you did respell: long vowels marked, including ea and oa; ழ is zh and ங is ng.',
    'Casual spoken Tamil, not the formal written form.',
  ],
  cardNote: 'Tamil script renders cleanly; keep cards short all the same.',
  phrases: [
    ['இப்போவே Book பண்ணுங்க', 'book now', 'ippovea book pannunga'],
    ['இன்றே', 'today only', 'indrea'],
    ['வாருங்கள்', 'please come', 'vaarungal'],
    ['பாருங்கள்', 'please see', 'paarungal'],
    ['வாழ்த்துக்கள்', 'congratulations', 'vaazhthukkal'],
    ['அருமை', 'great', 'arumai'],
    ['தள்ளுபடி', 'discount', 'thallupadi'],
    ['உங்க புது காரு', 'your new car', 'unga puthu kaaru'],
    ['சீக்கிரம் வாங்க', 'hurry up', 'seekkiram vaanga'],
    ['எங்க இடத்துக்கு வாங்க', 'visit us', 'enga idathukku vaanga'],
  ],
};

const TELUGU: Guide = {
  name: 'Telugu',
  nativeName: 'తెలుగు',
  code: 'te',
  script: 'Telugu script',
  traps: 'a long vowel that changes the word — including the long ఏ and ఓ — or a dropped aspiration',
  functionWords: 'మరియు, లో, కి, ని, తో',
  different: [
    '- Aspiration works as in Hindi, not Tamil. Telugu keeps the full aspirated series — ఖ kh, ఘ gh, ఛ chh, ఝ jh, థ th, ధ dh, ఫ f, భ bh — and uses it, especially in Sanskrit-derived words. Never drop the h.',
    '- Short and long e and o are different sounds, as in Tamil: ఎ / ఏ and ఒ / ఓ.',
    RETROFLEX_L('ళ', 'వెళ్ళు', 'Telugu script'),
    '- Retroflex and dental are not encoded; context carries them.',
  ].join('\n'),
  vowels: 'అ → a · ఆ → aa · ఇ → i · ఈ → ee · ఉ → u · ఊ → oo\nఎ → e · ఏ → ea (long) · ఐ → ai · ఒ → o · ఓ → oa (long) · ఔ → au · ం → trailing n or ng',
  consonants: 'kh, gh, chh, jh, th, dh, f, bh — keep the h, and write ఫ as f. ళ is written l if it must be respelled.',
  spoken: 'Write the casual spoken form an ad would use, not formal or literary Telugu.',
  upTo: 'వరకు',
  gender: 'First-person verbs are largely the same for a man and a woman — నేను చూపిస్తాను (I will show) does not change. Gender only matters when a line describes someone else.',
  checks: [
    'In the words you did respell: long vowels marked, including ea and oa; aspirated consonants keep their h.',
    'Casual spoken Telugu, not the formal written form.',
  ],
  cardNote: 'Avoid long stacked consonant clusters where a simpler word exists.',
  phrases: [
    ['ఇప్పుడే బుక్ చేయండి', 'book now', 'ippude book cheyandi'],
    ['ఈ రోజే', 'today only', 'ee rojea'],
    ['రండి', 'please come', 'randi'],
    ['చూడండి', 'please see', 'choodandi'],
    ['అభినందనలు', 'congratulations', 'abhinandanalu'],
    ['సూపర్', 'great', 'super', 'English loanword, very common in casual ads.', true],
    ['తగ్గింపు', 'discount', 'taggimpu'],
    ['మీ కొత్త కారు', 'your new car', 'mee kotta kaaru'],
    ['తొందరగా రండి', 'hurry up', 'tondaragaa randi'],
    ['మా దగ్గరకు రండి', 'visit us', 'maa daggaraku randi'],
  ],
};

export const REGIONAL_LANGUAGE_SEEDS: LanguageSeed[] = [ASSAMESE, BENGALI, KANNADA, MALAYALAM, MARATHI, PUNJABI, TAMIL, TELUGU].map(seed);
