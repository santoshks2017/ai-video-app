/**
 * Script writing, in two passes.
 *
 * The storyboard's `dialogue` fields are stage directions — "open with a sincere
 * greeting for the occasion" — not lines. Sending those to a video model as the
 * spoken line asks it to compose the language, pronounce it and lip-sync to it
 * all at once, which is where the delivery fell apart.
 *
 *   Pass 1 — COPY.       Write the lines in natural language, for meaning and
 *                        structure. No pronunciation encoding.
 *   Pass 2 — PRONOUNCE.  Convert each line into the spoken spelling, driven by
 *                        that language's guide from the Languages library.
 *
 * Splitting them is deliberate: the copy pass stays about the ad, the
 * pronunciation pass is a mechanical transform against a rulebook the design
 * team edits, and pass 2 can be re-run alone when the guide is tuned without
 * rewriting a word of approved copy. Both are text calls costing a fraction of a
 * rupee against Rs 100+ for a video segment.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface ScriptScene {
  index: number;
  title: string;
  /** The beat's stage direction — what this moment has to achieve. */
  direction: string;
  seconds: number;
  words: number;
  /** Exact on-screen card text for this scene, if any. */
  card?: string;
}

/** The language rules in force, resolved from the Languages library. */
export interface ScriptLanguage {
  name: string;
  code: string;
  /** False for a language that is written the way it is said, e.g. English. */
  needsPhonetics: boolean;
  /** The pronunciation rulebook, used verbatim as the pass-2 instruction. */
  spokenGuide: string;
  /** Locked spellings, applied before any rule is derived. */
  glossary: { term: string; say: string; note?: string }[];
}

export interface ScriptRequest {
  scenes: ScriptScene[];
  language: ScriptLanguage;
  gender: 'female' | 'male';
  dealerName: string;
  brandModel: string;
  city?: string;
  cta?: string;
  /** Category field values worth quoting — offer, occasion, feature and so on. */
  facts: Record<string, string>;
  /** Extra steer from global instructions and the project's own prompt. */
  direction?: string;
}

export interface ScriptLine {
  index: number;
  /** The readable line, for the designer to check the meaning. */
  line: string;
  /** The spoken spelling the video model performs. */
  say: string;
}

export class ScriptError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

/**
 * Which text model to use. Asking the API rather than hard-coding a name means
 * this keeps working as model names turn over; the answer is cached per process.
 */
let cachedTextModel: string | null = null;

export async function resolveTextModel(apiKey: string): Promise<string> {
  if (cachedTextModel) return cachedTextModel;
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) throw new ScriptError('script-models-unavailable', `Could not list Gemini models (${res.status}).`);
  const json = (await res.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  const usable = (json.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    // Video, image and embedding models can't write a script.
    .filter((n) => n && !/embed|image|video|omni|veo|imagen|tts|audio/i.test(n));

  // A flash-class text model is the right tool: cheap, fast, good at Hindi.
  const pick =
    usable.filter((n) => /flash/.test(n) && !/lite|thinking|exp|preview/.test(n)).sort().at(-1) ??
    usable.filter((n) => /flash/.test(n)).sort().at(-1) ??
    usable.filter((n) => /pro/.test(n)).sort().at(-1) ??
    usable[0];
  if (!pick) throw new ScriptError('script-no-text-model', 'No Gemini text model is available on this key.');
  cachedTextModel = pick;
  return pick;
}

async function ask(instruction: string, apiKey: string, temperature: number): Promise<string> {
  const model = await resolveTextModel(apiKey);
  const res = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: instruction }] }],
      generationConfig: { temperature, responseMimeType: 'application/json' },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string; status?: string };
  };
  if (!res.ok) {
    throw new ScriptError(
      json.error?.status ?? 'script-failed',
      json.error?.message ?? `Gemini returned ${res.status}.`,
    );
  }
  return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

/* ------------------------------- pass 1: copy ------------------------------ */

function copyInstruction(req: ScriptRequest): string {
  const lang = req.language.name;
  const verbs =
    req.gender === 'female'
      ? 'The presenter is a woman — use feminine verb forms throughout.'
      : 'The presenter is a man — use masculine verb forms throughout.';

  const facts = Object.entries(req.facts)
    .filter(([, v]) => String(v ?? '').trim())
    .map(([k, v]) => `  - ${k}: ${v}`);

  return [
    `You write the spoken lines for short Indian car-dealership ad videos in ${lang}. The lines are performed to camera by a presenter and lip-synced by an AI video model, so each must be exactly what she or he says — no stage directions, no narration about the shot.`,
    '',
    'STYLE',
    `- Everyday spoken ${lang} as people actually talk, not written or literary register.`,
    '- Keep the English words Indians use in English in English: test drive, EMI, on-road price, booking, offer, showroom, variant, service, down payment, and all brand and model names.',
    `- ${verbs}`,
    '- Short, natural sentences. One idea per line. No lists. Never repeat a phrase across lines.',
    '',
    'ACCURACY',
    '- Use only the facts given below. Never invent a price, EMI, discount, mileage, interest rate or waiting period.',
    '- Write numbers as words, the way they are spoken, never as digits, and never say the word "rupees" or use the ₹ symbol.',
    '',
    'CONTEXT',
    `- Dealership: ${req.dealerName}`,
    `- Car: ${req.brandModel}`,
    ...(req.city ? [`- City: ${req.city}`] : []),
    ...(req.cta ? [`- Call to action for the closing line: ${req.cta}`] : []),
    ...(facts.length ? ['- Facts you may quote:', ...facts] : []),
    ...(req.direction ? ['', 'EXTRA DIRECTION', req.direction] : []),
    '',
    'THE SCENES',
    'Write one line per scene. Each must fit its word budget at a natural, unhurried pace — over budget means the delivery gets rushed and the lip-sync breaks.',
    ...req.scenes.map(
      (s) =>
        `Scene ${s.index} — "${s.title}" · ${s.seconds}s · at most ${s.words} words${
          s.card ? ` · on-screen card reads "${s.card}"` : ''
        }\n  What this moment has to do: ${s.direction}`,
    ),
    '',
    'Return JSON only: an array of {"index": <scene index>, "line": "<the spoken line>"}. One object per scene, in order. No commentary.',
  ].join('\n');
}

/* ---------------------------- pass 2: pronounce ---------------------------- */

function phoneticInstruction(
  lines: { index: number; line: string }[],
  language: ScriptLanguage,
): string {
  const glossary = language.glossary
    .filter((g) => g.term?.trim() && g.say?.trim())
    .map((g) => `  ${g.term} → ${g.say}${g.note ? `  (${g.note})` : ''}`);

  return [
    `You convert ${language.name} ad copy into the spoken spelling an AI video model performs. Apply the standard below exactly.`,
    '',
    language.spokenGuide.trim(),
    '',
    ...(glossary.length
      ? [
          '## LOCKED SPELLINGS — use these exactly, do not re-derive them',
          'Consistency across videos matters more than deriving a fresh spelling each time. If a word below appears in a line, spell it exactly as shown. Brand and dealership names in particular must sound identical in every video.',
          ...glossary,
          '',
        ]
      : []),
    '## THE LINES',
    'Convert each line. Keep the meaning and the word order identical — this is a spelling transform, not a rewrite. Do not add, drop or reorder words.',
    ...lines.map((l) => `${l.index}: ${l.line}`),
    '',
    'Return JSON only: an array of {"index": <the same index>, "say": "<the converted line>"}. One object per line, in order. No commentary.',
  ].join('\n');
}

/* --------------------------------- driver --------------------------------- */

export async function writeScript(
  req: ScriptRequest,
  apiKey: string,
): Promise<{ model: string; lines: ScriptLine[] }> {
  if (!req.scenes.length) return { model: '', lines: [] };

  const copy = parseRows(await ask(copyInstruction(req), apiKey, 0.85), 'line').map((r) => ({
    index: r.index,
    line: r.text,
  }));
  if (!copy.length) throw new ScriptError('script-unparseable', 'The model did not return any usable lines.');

  const lines = await addPhonetics(copy, req.language, apiKey);
  return { model: await resolveTextModel(apiKey), lines };
}

/**
 * Pass 2 on its own. Exposed so a tuned pronunciation guide can be re-applied to
 * copy that is already approved, without paying to rewrite it.
 */
export async function addPhonetics(
  lines: { index: number; line: string }[],
  language: ScriptLanguage,
  apiKey: string,
): Promise<ScriptLine[]> {
  const usable = lines.filter((l) => Number.isFinite(l.index) && l.line?.trim());
  if (!usable.length) return [];
  // A language written the way it is said needs no transform.
  if (!language.needsPhonetics || !language.spokenGuide.trim()) {
    return usable.map((l) => ({ index: l.index, line: l.line, say: l.line }));
  }

  // Temperature 0: this is a transform against a rulebook, not a creative step.
  const said = new Map(
    parseRows(await ask(phoneticInstruction(usable, language), apiKey, 0), 'say').map((r) => [
      r.index,
      r.text,
    ]),
  );
  // A line the pass missed keeps its readable form — still better than nothing.
  return usable.map((l) => ({ index: l.index, line: l.line, say: said.get(l.index) || l.line }));
}

/** JSON mode is not guaranteed, so pull the array out of whatever came back. */
function parseRows(text: string, field: 'line' | 'say'): { index: number; text: string }[] {
  const attempt = (raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  const parsed = attempt(text) ?? (start >= 0 && end > start ? attempt(text.slice(start, end + 1)) : null);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((row) => {
      const r = row as Record<string, unknown>;
      const index = Number(r.index);
      const value = String(r[field] ?? r.line ?? r.dialogue ?? '').trim();
      return Number.isFinite(index) && value ? { index, text: value } : null;
    })
    .filter((x): x is { index: number; text: string } => x !== null);
}
