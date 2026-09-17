/**
 * The script each language is written in.
 *
 * A spoken line keeps its English words and names in Latin letters inside a sentence
 * in the language's own script — Devanagari for Hindi and Marathi, Tamil script for
 * Tamil — and the prompts have to say which script that is. A language with no entry
 * here is described as its native script; no language code at all means Hindi, which
 * is what a project without a language has always spoken.
 */
const SCRIPTS: Record<string, string> = {
  hi: 'Devanagari',
  mr: 'Devanagari',
  bn: 'Bengali script',
  as: 'Assamese script',
  pa: 'Gurmukhi',
  ta: 'Tamil script',
  te: 'Telugu script',
  kn: 'Kannada script',
  ml: 'Malayalam script',
  en: 'Latin',
};

export function scriptOf(code?: string): string {
  return SCRIPTS[(code ?? 'hi').trim().toLowerCase()] ?? 'native script';
}
