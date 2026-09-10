/**
 * Google Veo 3.1 client, on the same Gemini API key as Omni Flash.
 *
 * Veo is a long-running operation rather than Omni's synchronous interaction:
 *   POST /v1beta/models/{model}:predictLongRunning  -> { name: "models/…/operations/…" }
 *   GET  /v1beta/{name}                             -> { done, response.generateVideoResponse… }
 * and the finished file is downloaded from the returned URI with the same key.
 *
 * Its constraints shape how segments are planned, so they are enforced here
 * rather than trusted to the caller:
 *  - a clip is 4, 6 or 8 seconds — nothing in between;
 *  - 1080p, and any reference images, force 8 seconds;
 *  - at most 3 reference images, and never together with a first-frame image;
 *  - image input needs personGeneration "allow_adult", text alone "allow_all".
 * A planned 5.3s segment therefore renders at 6s (or 8s) and is trimmed to
 * length afterwards. The extra seconds are billed; they are never seen.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/veo
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const POLL_MS = 10_000;
/** Google quotes 11 seconds to 6 minutes at peak; leave room for a long queue. */
const MAX_WAIT_MS = 15 * 60 * 1000;

export interface VeoImage {
  /** Raw base64, no data: prefix. */
  data: string;
  mimeType: string;
}

export interface VeoInput {
  prompt: string;
  model: string;
  aspect: '9:16' | '1:1' | '16:9';
  resolution: '720p' | '1080p';
  /** The planned length. The rendered clip may be longer — see veoDuration. */
  duration: number;
  /** The previous segment's closing frame, for a seamless cut. */
  firstFrame?: VeoImage;
  references?: VeoImage[];
}

export interface VeoClip {
  operation: string;
  bytes: Buffer;
  mimeType: string;
  /** What Veo was asked to render — longer than planned whenever a rule forced 8s. */
  renderedSeconds: number;
}

export class VeoError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const headers = (apiKey: string): Record<string, string> => ({
  'content-type': 'application/json',
  'x-goog-api-key': apiKey,
});

/** The clip length Veo must be asked for: the shortest allowed value that holds the segment. */
export function veoDuration(
  planned: number,
  opts: { resolution: '720p' | '1080p'; withReferences: boolean },
): 4 | 6 | 8 {
  if (opts.resolution !== '720p' || opts.withReferences) return 8;
  if (planned <= 4) return 4;
  if (planned <= 6) return 6;
  return 8;
}

/**
 * Veo marks dialogue with quotation marks; the storyboard marks it with braces,
 * which is what Seedance reads. Converting here keeps the storyboard
 * provider-neutral and hands Veo the marker it treats as an exact line — the
 * difference between reading a line once and improvising around it.
 */
export function veoPrompt(prompt: string): string {
  return prompt
    .replace(/(Says, word for word:\s*)\{([^{}]*)\}/g, (_m, lead: string, line: string) => `${lead}"${line.trim()}"`)
    .replace(/inside the braces/gi, 'inside the quotation marks')
    .replace(/HOW TO READ THE BRACES/g, 'HOW TO READ THE QUOTED LINES');
}

export async function generateVeoClip(input: VeoInput, apiKey: string): Promise<VeoClip> {
  if (!apiKey) throw new VeoError('veo-not-configured', 'No Gemini API key is available for Veo.', 503);

  // References and a first frame cannot be combined. On a continuation segment
  // the seed frame wins, as on Seedance: it is what makes the cut seamless, and
  // it already carries the car, the presenter and the location.
  const firstFrame = input.firstFrame;
  const references = firstFrame ? [] : (input.references ?? []).slice(0, 3);
  const seconds = veoDuration(input.duration, {
    resolution: input.resolution,
    withReferences: references.length > 0,
  });

  const inline = (img: VeoImage) => ({ inlineData: { mimeType: img.mimeType, data: img.data } });
  const instance: Record<string, unknown> = { prompt: veoPrompt(input.prompt) };
  if (firstFrame) instance.image = inline(firstFrame);
  if (references.length) {
    instance.referenceImages = references.map((r) => ({ image: inline(r), referenceType: 'asset' }));
  }

  const body = {
    instances: [instance],
    parameters: {
      aspectRatio: input.aspect === '1:1' ? '16:9' : input.aspect,
      resolution: input.resolution,
      durationSeconds: String(seconds),
      // Veo refuses "allow_all" once any image is supplied.
      personGeneration: firstFrame || references.length ? 'allow_adult' : 'allow_all',
      numberOfVideos: 1,
    },
  };

  let name = '';
  // Preview models rate-limit tightly — retry 429 / 5xx with backoff, as Omni does.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}/models/${input.model}:predictLongRunning`, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      name?: string;
      error?: { status?: string; message?: string };
    };
    if (res.ok && json.name) {
      name = json.name;
      break;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 3) {
      await sleep((attempt + 1) * 15_000);
      continue;
    }
    throw new VeoError(
      json.error?.status ?? 'veo-error',
      json.error?.message ?? `Veo returned ${res.status} starting the generation.`,
      res.status === 429 ? 429 : 502,
    );
  }
  if (!name) throw new VeoError('veo-no-operation', 'Veo accepted the request but returned no operation.');

  const uri = await pollOperation(name, apiKey);
  const file = await fetch(uri, { headers: { 'x-goog-api-key': apiKey }, redirect: 'follow' });
  if (!file.ok) throw new VeoError('veo-download-failed', `Could not download the finished video (${file.status}).`);
  return {
    operation: name,
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: file.headers.get('content-type') || 'video/mp4',
    renderedSeconds: seconds,
  };
}

interface VeoOperation {
  done?: boolean;
  error?: { code?: number; status?: string; message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: { video?: { uri?: string } }[];
      raiMediaFilteredCount?: number;
      raiMediaFilteredReasons?: string[];
    };
  };
}

async function pollOperation(name: string, apiKey: string): Promise<string> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const res = await fetch(`${BASE}/${name}`, { headers: headers(apiKey) });
    const op = (await res.json().catch(() => ({}))) as VeoOperation;
    if (!res.ok) {
      // A blip while polling is not a failed generation — keep waiting.
      if (res.status === 429 || res.status >= 500) continue;
      throw new VeoError(
        op.error?.status ?? 'veo-poll-failed',
        op.error?.message ?? `Veo returned ${res.status} while polling.`,
      );
    }
    if (!op.done) continue;
    if (op.error) {
      throw new VeoError(op.error.status ?? 'veo-failed', op.error.message ?? 'Veo reported a failure without a message.');
    }
    const out = op.response?.generateVideoResponse;
    const uri = out?.generatedSamples?.[0]?.video?.uri;
    if (uri) return uri;
    // A safety filter finishes the operation with no sample — say why, rather
    // than a bare "no video" that sends someone hunting for a bug.
    const why = out?.raiMediaFilteredReasons?.join(' ');
    throw new VeoError(
      why ? 'veo-filtered' : 'veo-no-video',
      why ? `Veo filtered the output: ${why}` : 'Veo finished but returned no video.',
      422,
    );
  }
  throw new VeoError('veo-timeout', `Veo was still generating after ${Math.round(MAX_WAIT_MS / 60000)} minutes.`, 504);
}
