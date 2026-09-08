/**
 * Script writing.
 *
 * The storyboard's `dialogue` fields are stage directions — "open with a sincere
 * greeting for the occasion" — not lines. Sending those to a video model as the
 * spoken line asks it to compose Hindi, pronounce it and lip-sync to it, all
 * from an English brief. Gemini coped; Seedance does not, and Hindi is not even
 * on its published speech-language list.
 *
 * So the direction becomes a real line here, in Devanagari, before any paid
 * video call — the designer edits it in the storyboard, and the video model is
 * then reading rather than improvising. Text generation costs a fraction of a
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
      ? 'The presenter is a woman — use feminine verb forms throughout (रही हूं, करती हूं, बताती हूं).'
      : 'The presenter is a man — use masculine verb forms throughout (रहा हूं, करता हूं, बताता हूं).';

  const facts = Object.entries(req.facts)
    .filter(([, v]) => String(v ?? '').trim())
    .map(([k, v]) => `- ${k}: ${v}`);

  return [
    'You write the spoken lines for short Indian car-dealership ad videos. The lines are performed to camera by a presenter and then lip-synced by a video model, so they must be exactly what she or he says — no stage directions, no narration about the shot.',
    '',
    'LANGUAGE',
    '- Write in everyday spoken Hindi, in Devanagari script. This is Hinglish as people actually speak it: keep English words that Indians use in English — test drive, EMI, on-road price, booking, offer, showroom, variant, service, down payment, model names and brand names — in Latin script, inside the Devanagari sentence.',
    '- Avoid literary Hindi nobody says out loud (समय, सुविधा, जानकारी, कारण, रूचि). Use the plain English word instead.',
    `- ${verbs}`,
    '- Short, natural sentences. One idea per line. No lists. Never repeat a phrase across lines.',
    '',
    'ACCURACY',
    '- Use only the facts given below. Never invent a price, EMI, discount, mileage, interest rate or waiting period.',
    '- Write numbers as words, the way they are spoken (दो लाख पच्चीस हज़ार), never as digits.',
    '- Never say the word "rupees" or the ₹ symbol out loud — just the number in words.',
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
    'Write one line per scene. Each line must fit its word budget when spoken at a natural, unhurried pace — going over means the delivery gets rushed and the lip-sync breaks.',
    ...req.scenes.map(
      (s) =>
        `Scene ${s.index} — "${s.title}" · ${s.seconds}s · at most ${s.words} words${
          s.card ? ` · on-screen card reads "${s.card}"` : ''
        }\n  What this moment has to do: ${s.direction}`,
    ),
    '',
    'Return JSON only: an array of objects {"index": <scene index>, "line": "<the spoken line>"}. One object per scene, in order. No commentary.',
  ].join('\n');
}

export async function writeScript(
  req: ScriptRequest,
  apiKey: string,
): Promise<{ model: string; lines: { index: number; line: string }[] }> {
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

/** JSON mode is not guaranteed, so pull the array out of whatever came back. */
function parseLines(text: string): { index: number; line: string }[] {
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
      const r = row as { index?: unknown; line?: unknown; dialogue?: unknown };
      const index = Number(r.index);
      const line = String(r.line ?? r.dialogue ?? '').trim();
      return Number.isFinite(index) && line ? { index, line } : null;
    })
    .filter((x): x is { index: number; line: string } => x !== null);
}
