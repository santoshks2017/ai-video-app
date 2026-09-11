/**
 * The spoken line, as plain words.
 *
 * The pronunciation pass used to mark stress in capitals and split syllables with
 * hyphens — "AAJ hi", "se sha-ROO", "buk KEE-ji-ye". The video model read the capitals
 * as letters to spell out, stumbled over the syllable breaks and doubled words, and it
 * already says everyday Hindi correctly as written. So every spoken line is brought
 * back to ordinary words before it reaches a model: capitals only where an acronym is
 * said letter by letter, no syllable hyphens, and no word said twice that the line
 * says once.
 */

/** Acronyms said letter by letter, which keep their capitals. */
const ACRONYMS = new Set([
  'ABS', 'EBD', 'ESP', 'ESC', 'TCS', 'HSA', 'HHC', 'HDC', 'VSM', 'ADAS', 'TPMS', 'ISOFIX',
  'EMI', 'SUV', 'MPV', 'MUV', 'CNG', 'LPG', 'EV', 'EVS', 'HEV', 'PHEV',
  'AMT', 'CVT', 'DCT', 'IVT', 'MT', 'AT', 'AWD', 'FWD', 'RWD',
  'AC', 'LED', 'LEDS', 'DRL', 'DRLS', 'USB', 'GPS', 'ORVM', 'ORVMS', 'IRVM', 'OTA', 'HUD', 'TFT', 'HD',
  'NCAP', 'BNCAP', 'GNCAP', 'RTO', 'GST', 'KMPL', 'BHP', 'PS', 'NM', 'CC', 'MM', 'SOS',
]);

/** Spellings the old guide locked in, back to the ordinary words they stood for. */
const PLAIN: Record<string, string> = {
  'kee-ji-ye': 'kijiye', buk: 'book', 'sha-roo': 'shuru', 'jal-dee': 'jaldi', 'ka-ren': 'karen',
  'aa-i-ye': 'aaiye', 'de-khi-ye': 'dekhiye', 'jaa-ni-ye': 'jaaniye', 'sam-jhi-ye': 'samjhiye',
  'sha-aan-daar': 'shaandaar', 'faa-y-de': 'faayde', 'peh-li': 'pehli', 'jha-lak': 'jhalak',
  'up-labdh': 'uplabdh', 'ba-dhaa-ee': 'badhaai', 'na-yee': 'nayi', 'gaa-dee': 'gaadi',
  'a-nu-bhav': 'anubhav', 'san-tusht': 'santusht', 'mu-jhe': 'mujhe', 'ba-hut': 'bahut',
  'pa-sand': 'pasand', 'aa-yee': 'aayi', 'tyo-haar': 'tyohaar', 'shubh-kaam-na-yen': 'shubhkaamnayein',
  'ma-hee-ne': 'maheene', 'ha-zaar': 'hazaar', 'ra-he': 'rahe',
};

/** A line's words. Devanagari vowel signs are marks, not letters, so they are kept inside the word. */
const words = (text: string): string[] =>
  text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);

/**
 * A spoken line with stress capitals, syllable hyphens and doubled words taken out.
 * `readable` is the line as written for people: a word it already writes in capitals
 * (XUV, 3XO) keeps them, and a repetition it really makes ("bahut bahut") is kept.
 */
export function plainSpoken(say: string, readable = ''): string {
  const writtenCaps = new Set(readable.match(/[A-Z]{2,}/g) ?? []);
  const cleaned = say
    .split(/(\s+)/)
    .map((piece) => {
      const m = /^([^A-Za-z]*)([A-Za-z][A-Za-z-]*[A-Za-z]|[A-Za-z])([^A-Za-z]*)$/.exec(piece);
      if (!m) return piece;
      const [, lead, core, tail] = m as unknown as [string, string, string, string];
      const lower = core.toLowerCase();
      const known = PLAIN[lower];
      if (known) return lead + known + tail;
      // Syllables split with hyphens and a capital for the stress: one ordinary word.
      if (/[A-Z]/.test(core) && /^[A-Za-z]+(-[A-Za-z]+)+$/.test(core)) return lead + lower.replace(/-/g, '') + tail;
      // Capitals are spelled out letter by letter, so only an acronym keeps them.
      if (core.length > 1 && core === core.toUpperCase() && !ACRONYMS.has(core) && !writtenCaps.has(core)) {
        return lead + lower + tail;
      }
      return piece;
    })
    .join('');

  // A word said twice in a row that the line says once. A line that really repeats a
  // word somewhere ("bahut bahut") is left as it is.
  const readableWords = words(readable);
  if (readableWords.some((w, i) => i > 0 && readableWords[i - 1] === w)) return cleaned.trim();
  const kept: string[] = [];
  let previous = '';
  for (const piece of cleaned.split(/(\s+)/)) {
    if (!piece.trim()) {
      kept.push(piece);
      continue;
    }
    const w = words(piece).join(' ');
    if (w && w === previous) {
      if (kept.length && !kept[kept.length - 1]!.trim()) kept.pop();
      continue;
    }
    kept.push(piece);
    if (w) previous = w;
  }
  return kept.join('').trim();
}
