/**
 * Script writing.
 *
 * The storyboard's `dialogue` fields are stage directions — "open with a sincere
 * greeting for the occasion" — not lines. Sending those to a video model as the
 * spoken line asks it to compose Hindi, pronounce it and lip-sync to it, all
 * from an English brief. Gemini coped; Seedance does not, and Hindi is not even
 * on its published speech-language list.
 *
 * So the direction becomes a real line here, before any paid video call — the
 * designer edits it in the storyboard, and the video model reads rather than
 * improvises. Text generation costs a fraction of a rupee against Rs 100+ for a
 * video segment.
 *
 * Each line comes back twice. `line` is plain readable Hindi/Hinglish so a human
 * can check the meaning. `say` is the same line RESPELLED FOR PRONUNCIATION —
 * syllables hyphenated, stressed syllable capitalised — and that is what reaches
 * the video model. Devanagari alone tells a model which words to say but not how
 * an Indian presenter says them, and the models get the stress and the vowel
 * lengths wrong; the respelling is what fixes the delivery.
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

export interface ScriptRequest {
  scenes: ScriptScene[];
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

function buildInstruction(req: ScriptRequest): string {
  const verbs =
    req.gender === 'female'
      ? 'The presenter is a woman — use feminine verb forms throughout (रही हूं / ra-HEE hoon, करती हूं / kar-TEE hoon).'
      : 'The presenter is a man — use masculine verb forms throughout (रहा हूं / ra-HAA hoon, करता हूं / kar-TAA hoon).';

  const facts = Object.entries(req.facts)
    .filter(([, v]) => String(v ?? '').trim())
    .map(([k, v]) => `- ${k}: ${v}`);

  return [
    'You write the spoken lines for short Indian car-dealership ad videos. The lines are performed to camera by a presenter and lip-synced by an AI video model, so they must be exactly what she or he says — no stage directions, no narration about the shot.',
    '',
    'For every scene you return TWO forms of the same line.',
    '',
    '1. "line" — the natural, readable version in everyday spoken Hindi, Devanagari script, with the English words Indians actually use in English kept in Latin script (test drive, EMI, on-road price, booking, offer, showroom, variant, service, down payment, brand and model names). This is for a human to read and check the meaning.',
    '',
    '2. "say" — THE SAME LINE RESPELLED FOR PRONUNCIATION, in Latin letters. This is the one the video model performs, and it is the whole point of the exercise: models given plain Hindi put the stress in the wrong place and shorten the long vowels, and the delivery comes out sounding foreign. Respelling fixes that.',
    '',
    'RESPELLING RULES for "say":',
    '- Latin letters only. Spell each word the way it SOUNDS, not the way it is normally romanised.',
    '- Split every multi-syllable word into syllables with hyphens: KEE-ji-ye, ba-NAA-i-ye, sha-aan-DAAR.',
    '- CAPITALISE the stressed syllable of each content word. A stressed single-syllable word goes fully capitalised: LAKH, AAJ, BAAT. Leave unstressed grammar words in lower case: ka, ki, hi, toh, aur, tak, ap-ni.',
    '- Double a vowel to make it long: AAJ (आज), DRAAIV (drive), ha-ZAAR (हज़ार), AG-lee (अगली), VAN-taa.',
    '- Respell English loanwords the way an Indian presenter says them, not the way they are spelled in English: discount is dis-KAAUNT, Motors is MO-tarz, Premier is pre-MEER, drive is DRAAIV, price is PRAAIS.',
    '- Respell brand and dealership names phonetically too, so they are not read as English: Byte becomes BAAIT, Premier Motors becomes pre-MEER MO-tarz.',
    '- Write every number as spoken words, respelled: "do LAKH pach-CHEES ha-ZAAR". Never digits, never the ₹ symbol, and never the word "rupees".',
    '- Use an em dash ( — ) where the presenter takes a short breath.',
    '- Well-known short acronyms stay as they are: SUV, EMI, ABS.',
    '',
    'WORKED EXAMPLES of the "say" form — match this style exactly:',
    '  do LAKH pach-CHEES ha-ZAAR ru-Pae tak ka CASH dis-KAAUNT',
    '  BAAIT VAN-taa EKS — AAJ hi TEST DRAAIV buk KEE-ji-ye',
    '  toh DER kis BAAT ki — BAAIT VAN-taa EKS ko ba-NAA-i-ye ap-ni AG-lee SUV',
    '  aur ab BAAIT pre-MEER MO-tarz par mil ra-HE hain sha-aan-DAAR FAA-y-de',
    '',
    'LANGUAGE',
    `- ${verbs}`,
    '- Everyday spoken Hindi. Avoid literary words nobody says out loud (समय, सुविधा, जानकारी, कारण, रूचि) — use the plain English word instead.',
    '- Short, natural sentences. One idea per line. No lists. Never repeat a phrase across lines.',
    '',
    'ACCURACY',
    '- Use only the facts given below. Never invent a price, EMI, discount, mileage, interest rate or waiting period.',
    '',
    'CONTEXT',
    `- Dealership: ${req.dealerName}`,
    `- Car: ${req.brandModel}`,
    ...(req.city ? [`- City: ${req.city}`] : []),
    ...(req.cta ? [`- Call to action for the closing line: ${req.cta}`] : []),
    ...(facts.length ? ['- Facts you may quote:', ...facts.map((f) => `  ${f}`)] : []),
    ...(req.direction ? ['', 'EXTRA DIRECTION', req.direction] : []),
    '',
    'THE SCENES',
    'Write one line per scene. Each must fit its word budget when spoken at a natural, unhurried pace — over budget means the delivery gets rushed and the lip-sync breaks.',
    ...req.scenes.map(
      (s) =>
        `Scene ${s.index} — "${s.title}" · ${s.seconds}s · at most ${s.words} words${
          s.card ? ` · on-screen card reads "${s.card}"` : ''
        }\n  What this moment has to do: ${s.direction}`,
    ),
    '',
    'Return JSON only: an array of {"index": <scene index>, "line": "<readable Hindi>", "say": "<the same line respelled for pronunciation>"}. One object per scene, in order. No commentary.',
  ].join('\n');
}

export async function writeScript(
  req: ScriptRequest,
  apiKey: string,
): Promise<{ model: string; lines: ScriptLine[] }> {
  if (!req.scenes.length) return { model: '', lines: [] };
  const model = await resolveTextModel(apiKey);

  const res = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildInstruction(req) }] }],
      generationConfig: { temperature: 0.8, responseMimeType: 'application/json' },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string; status?: string };
  };
  if (!res.ok) {
    throw new ScriptError(json.error?.status ?? 'script-failed', json.error?.message ?? `Gemini returned ${res.status}.`);
  }

  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const lines = parseLines(text);
  if (!lines.length) throw new ScriptError('script-unparseable', 'The model did not return any usable lines.');
  return { model, lines };
}

export interface ScriptLine {
  index: number;
  /** Readable Hindi/Hinglish, for the designer. */
  line: string;
  /** The respelled form the video model actually performs. */
  say: string;
}

/** JSON mode is not guaranteed, so pull the array out of whatever came back. */
function parseLines(text: string): ScriptLine[] {
  const attempt = (raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  const parsed =
    attempt(text) ?? (start >= 0 && end > start ? attempt(text.slice(start, end + 1)) : null);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((row) => {
      const r = row as { index?: unknown; line?: unknown; dialogue?: unknown; say?: unknown };
      const index = Number(r.index);
      const line = String(r.line ?? r.dialogue ?? '').trim();
      // If the respelling is missing, fall back to the readable line rather than
      // dropping the scene — a plain line still beats no line at all.
      const say = String(r.say ?? '').trim() || line;
      return Number.isFinite(index) && line ? { index, line, say } : null;
    })
    .filter((x): x is ScriptLine => x !== null);
}
