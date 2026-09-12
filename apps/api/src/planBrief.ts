/**
 * Reading the designer's brief, so the project fills itself in.
 *
 * A brief is one sentence with everything in it — "a Ganesh Chaturthi post inviting
 * customers to buy a bike" names the occasion, the use case, the vehicle type and the
 * tone. Making the designer then re-enter all of that as use cases and fields is work
 * the app can do, so the brief is read once and the answers are proposed.
 *
 * Two rules keep this safe. Nothing is invented: a price, a discount, a date or a
 * claim the brief does not state is left blank for the team to fill. And nothing is
 * accepted on trust: every use case, option and vehicle that comes back is checked
 * against the library before it can reach the project (see applyBriefPlan).
 */

import { CATEGORIES, CATEGORY_BY_ID, NARRATION, type BriefPlan, type CategoryId } from '@ava/shared';
import { resolveTextModel } from './script.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export class PlanError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export interface PlanContext {
  prompt: string;
  client?: { name?: string; displayName?: string; brand?: string; brands?: string[]; city?: string; vehicleKind?: string } | null;
  cars: { brand: string; model: string; kind?: string; colours?: { name: string }[] }[];
  actors: { name: string; gender?: string; style?: string }[];
}

/** What each use case is, and the exact keys its fields are stored under. */
function useCaseBlock(): string {
  return CATEGORIES.map((c) => {
    const fields = c.fields.map((f) => {
      if (f.type === 'list' && f.list) {
        const sub = f.list.sub ? `, and ${f.list.sub.id}1…${f.list.sub.id}${f.list.max} — ${f.list.sub.label}` : '';
        return `    ${f.id}1 … ${f.id}${f.list.max} — ${f.label}, one ${f.list.noun} per key${sub}`;
      }
      if (f.type === 'select') return `    ${f.id} — ${f.label}. Exactly one of: ${(f.options ?? []).join(' | ')}`;
      if (f.type === 'checkbox') return `    ${f.id} — ${f.label}. "yes", or leave it out`;
      return `    ${f.id} — ${f.label}${f.ph ? ` (${f.ph.replace(/^e\.g\.\s*/i, 'e.g. ')})` : ''}`;
    });
    const musts = c.mandatory.map((m) => m.id).join(', ');
    return [`  ${c.id} — ${c.label}. ${c.purpose}${musts ? ` Needs: ${musts}.` : ''}`, ...fields].join('\n');
  }).join('\n');
}

function instruction(ctx: PlanContext): string {
  const cars = ctx.cars
    .slice(0, 80)
    .map((c) => `  ${c.brand} ${c.model}${c.colours?.length ? ` — colours: ${c.colours.slice(0, 10).map((x) => x.name).join(', ')}` : ''}`)
    .join('\n');
  const actors = ctx.actors.map((a) => `  ${a.name}${a.gender ? ` (${a.gender})` : ''}${a.style ? ` — ${a.style}` : ''}`).join('\n');
  const brands = ctx.client?.brands?.length ? ctx.client.brands.join(', ') : (ctx.client?.brand ?? '');

  return [
    'You set up a video project for an Indian vehicle dealership from the brief its designer wrote.',
    'You decide which use cases the film needs and fill in what the brief actually says. You do not write the script.',
    '',
    '## THE BRIEF',
    `  "${ctx.prompt.trim()}"`,
    '',
    ...(ctx.client
      ? [
          '## THE DEALER',
          `  ${ctx.client.displayName || ctx.client.name || 'this dealership'}${brands ? ` — ${brands}` : ''}${
            ctx.client.city ? `, ${ctx.client.city}` : ''
          }. Sells ${ctx.client.vehicleKind === 'bike' ? 'bikes and scooters' : 'cars'}.`,
          '',
        ]
      : []),
    ...(cars ? ['## VEHICLES IN THE LIBRARY — pick only from these', cars, ''] : []),
    ...(actors ? ['## PRESENTERS IN THE LIBRARY — pick only from these', actors, ''] : []),
    '## THE USE CASES AND THEIR FIELDS',
    useCaseBlock(),
    '',
    '## HOW TO CHOOSE',
    '- One or two use cases is the usual answer; three at the very most. A festival, a season or an occasion is festival.',
    '  A discount, a benefit, a limited-period deal or an EMI offer is offer. Features or specs are feature. An invitation to',
    '  come and drive or ride is testdrive. A handover or a new owner is delivery.',
    '- Fill a field ONLY from what the brief says or plainly means. The occasion in "Ganesh Chaturthi post" is Ganesh Chaturthi.',
    '- NEVER invent a price, a discount, an amount, an interest rate, a date, a deadline or a claim. If the brief does not say it,',
    '  leave the field out entirely — the team fills those in, and a made-up number in a dealer ad is a real problem.',
    '- A select field takes one of its listed options, copied exactly. Anything else is dropped.',
    '- narration: one of ' + Object.keys(NARRATION).join(' | ') + '. A presenter speaking to camera is "presenter"; a film with no',
    '  person on screen is "voiceover"; music and text only is "silent".',
    '- aspect: 9:16 for a social post or a reel, 16:9 for a website or a TV screen, 1:1 for a feed post. Default 9:16.',
    '- captionStyle: Long Narrative | Short Punchy | Structured.',
    '- cta: the line the film ends on, in English, as a showroom would say it.',
    '- music: a few words describing the bed, matching the occasion and the use cases.',
    '- vehicle: only a model from the library above, and only if the brief points at one. colour: only one the library lists for it.',
    '- actor: only a presenter from the library above, and only if the brief points at one.',
    '',
    'Return JSON only:',
    '{"useCases": ["festival"], "fieldValues": {"festival": {"occasionName": "Ganesh Chaturthi"}},',
    ' "spec": {"narration": "presenter", "aspect": "9:16", "cta": "...", "music": "...", "captionStyle": "Short Punchy"},',
    ' "vehicle": {"model": "...", "colour": "..."}, "actor": "...",',
    ' "why": "<one sentence to the designer on what you understood>"}',
    'Leave out anything the brief does not support. No commentary.',
  ].join('\n');
}

/** Only what the library recognises survives: the rest is quietly dropped. */
function clean(raw: Record<string, any>): BriefPlan {
  const useCases = [...new Set((raw.useCases ?? []).map((x: unknown) => String(x)))].filter(
    (id): id is CategoryId => Boolean(CATEGORY_BY_ID[id as CategoryId]),
  );

  const fieldValues: BriefPlan['fieldValues'] = {};
  for (const [id, values] of Object.entries(raw.fieldValues ?? {})) {
    const cat = CATEGORY_BY_ID[id as CategoryId];
    if (!cat || !values || typeof values !== 'object') continue;
    const kept: Record<string, string> = {};
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      const text = String(value ?? '').trim();
      if (!text) continue;
      const known = cat.fields.some(
        (f) =>
          f.id === key ||
          (f.type === 'list' && f.list && (new RegExp(`^${f.id}\\d+$`).test(key) || (f.list.sub && new RegExp(`^${f.list.sub.id}\\d+$`).test(key)))),
      );
      if (known) kept[key] = text;
    }
    if (Object.keys(kept).length) fieldValues[id as CategoryId] = kept;
  }

  const spec: BriefPlan['spec'] = {};
  const s = raw.spec ?? {};
  if (typeof s.narration === 'string' && s.narration in NARRATION) spec.narration = s.narration;
  if (['9:16', '1:1', '16:9'].includes(s.aspect)) spec.aspect = s.aspect;
  if (['Long Narrative', 'Short Punchy', 'Structured'].includes(s.captionStyle)) spec.captionStyle = s.captionStyle;
  for (const key of ['cta', 'music', 'visualStyle'] as const) {
    if (typeof s[key] === 'string' && s[key].trim()) spec[key] = s[key].trim();
  }
  const pace = Number(s.pace);
  if (Number.isFinite(pace) && pace >= 0.9 && pace <= 1.5) spec.pace = pace;

  return {
    useCases,
    fieldValues,
    spec,
    vehicle: raw.vehicle?.model
      ? { model: String(raw.vehicle.model).trim(), colour: raw.vehicle.colour ? String(raw.vehicle.colour).trim() : undefined }
      : undefined,
    actor: raw.actor ? String(raw.actor).trim() : undefined,
    why: raw.why ? String(raw.why).trim() : undefined,
  };
}

export async function planFromBrief(ctx: PlanContext, apiKey: string): Promise<BriefPlan> {
  if (!ctx.prompt.trim()) throw new PlanError('plan-no-brief', 'Write the brief first.', 400);
  const model = await resolveTextModel(apiKey, 'write');
  const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: instruction(ctx) }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string; status?: string };
  };
  if (!res.ok) {
    throw new PlanError(json.error?.status ?? 'plan-failed', json.error?.message ?? `Gemini returned ${res.status}.`);
  }
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  try {
    return clean(JSON.parse(text.replace(/^```json|```$/g, '').trim()));
  } catch {
    throw new PlanError('plan-unreadable', 'The brief could not be read into a project. Try rewording it.');
  }
}
