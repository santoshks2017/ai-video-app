import type { Gender } from './types.js';

/**
 * Pronunciation / delivery rulebook, gender-adapted. Injected into every master
 * prompt that contains speech — automated categories AND the prompt-only
 * presenter categories (PRD P0.8 / P0.11). Ported verbatim from the legacy tool;
 * do not paraphrase — the Playwright suite asserts specific lines.
 */
export function rulebookText(gender: Gender): string {
  const verbLine =
    gender === 'male'
      ? 'The promoter is male: lock masculine Hindi verb forms throughout — “रहा हूं”, “करता हूं”, “बताता हूं” — never the feminine forms.'
      : 'The promoter is female: lock feminine Hindi verb forms throughout — “रही हूं”, “करती हूं”, “बताती हूं” — never the masculine forms.';

  return [
    '1. PERSONA & DELIVERY',
    '- ' + verbLine,
    '- Base language is Hindi/Hinglish, not English. Keep technical terms (EMI, on-road price, test drive, variant, down payment) in English rather than translating them into formal Hindi.',
    '- Speak in full, natural sentences. Never deliver a list — a human presenter doesn\'t talk that way.',
    '- Don\'t reuse the same phrasing twice in the same script.',
    '',
    '2. LANGUAGE STYLE',
    '- Keep vocabulary simple. Avoid literary Hindi that doesn\'t come up in daily speech (समय, सुविधा, जानकारी, कारण, रूचि) — use the plain English word instead (time, facility, information, reason, interest).',
    '- Avoid scripted-sounding filler: “क्या यह सही है?”, “दोस्त”, “बहुत अच्छा”.',
    '- Short, punchy sentences — one idea per sentence.',
    '',
    '3. NUMBER, CURRENCY & PERCENTAGE PRONUNCIATION',
    '- Spell out numbers in words, never digit by digit: 307 is “Three Hundred Seven”.',
    '- Decimals read the point as “point”: 42.8 is “Forty-Two point Eight”.',
    '- Percentages in full: 8.99% is “eight point nine nine percent”.',
    '- Currency: never say “Rupees”, “Rs.” or “₹” out loud — state the number in words only (“One Lakh Fifty Thousand”).',
    '- Variant names with (O) or /O are said as “Optional”, never the letter O: “VXi (O)” is “V-X-I Optional”.',
    '',
    '4. TECHNICAL SPEC PRONUNCIATION',
    'Split the number from the unit, then convert each separately:',
    '- Mileage “45.71 kmpl” becomes “forty-five point seven one” (drop the unit).',
    '- Engine “124.8cc” becomes “one hundred twenty-four point eight C C engine”.',
    '- Torque “10.6 Nm” becomes “ten point six N M”.',
    '- Power “11.38 PS” becomes “eleven point three eight P S of power”.',
    '',
    '5. ABBREVIATIONS',
    'Read as separate letters: EMI is E-M-I, ABS is A-B-S, CBS is C-B-S, ROI is R-O-I. Exception: CIBIL is said as a word.',
    '',
    '6. BREVITY',
    '- One concise sentence per feature, price or spec claim — don\'t lecture.',
    '- Highlight, don\'t list: one or two strongest points only.',
    '',
    '7. COMPETITIVE COMPARISON (only if the script contains a comparison beat)',
    'Acknowledge the competitor first, then land one or two data points — on-road price, running cost, resale, service network or EMI. Structure: “[Competitor] एक अच्छी कार है, लेकिन आपके budget में [our model] भी एक excellent option है”, then a soft CTA. Never criticise the competitor.',
    '',
    '8. RECOMMENDATION LOGIC',
    '- Never pitch a model below the customer\'s evident budget or segment.',
    '- Compare only within the same or an adjacent segment.',
    '',
    '9. ACCURACY',
    'Never invent a price, EMI, mileage, interest rate or waiting period beyond the figures given in this prompt. If a number isn\'t supplied, use a “starting from” framing instead of inventing one.',
  ].join('\n');
}
