/**
 * Gemini Omni Flash client (PRD P0.1 / P0.7).
 *
 * Omni Flash is a video-generation + conversational-editing model exposed through
 * the Interactions API (NOT generateContent):
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 * Multi-turn continuity — which the PRD's create-then-extend chunking depends on —
 * is `previous_interaction_id`: the model carries the prior clip and its
 * references forward without re-supplying them.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/omni
 * Model: gemini-omni-1.1-flash (3–10s per clip, 24fps, 360p/720p/1080p/4K, 16:9 or 9:16).
 *
 * Response shapes vary between SDK-normalised and raw REST, so the video is
 * located tolerantly (steps[].content[], output_video, response.*).
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface OmniRef {
  /** Publicly fetchable URL (e.g. a Storage signed URL) or a data: URI. */
  uri?: string;
  /** Raw base64 (no data: prefix). */
  data?: string;
  mimeType: string;
  kind: 'image' | 'video';
}

export interface GenerateClipInput {
  prompt: string;
  aspect: '9:16' | '1:1' | '16:9';
  resolution: '360p' | '720p' | '1080p' | '4k';
  references?: OmniRef[];
  /** Present for every part after the first — the create call's interaction id. */
  previousInteractionId?: string;
  task: 'text_to_video' | 'reference_to_video' | 'image_to_video' | 'extend';
  /** Provider model id; defaults to the deploy-time setting. */
  model?: string;
}

export interface GeneratedClip {
  interactionId: string;
  mimeType: string;
  /** base64 (delivery=base64) — mutually exclusive with fileUri. */
  base64?: string;
  /** files/{id} resource, resolved + downloaded by the caller (delivery=uri). */
  fileId?: string;
}

export class OmniFlashError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

function headers(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
}

function buildInput(prompt: string, refs: OmniRef[] | undefined): unknown {
  if (!refs || refs.length === 0) return prompt;
  // Docs: image items first, then the text item. Text item uses `text`, not `data`.
  return [
    ...refs.map((r) => ({
      type: r.kind,
      ...(r.uri ? { uri: r.uri } : { data: r.data, mime_type: r.mimeType }),
    })),
    { type: 'text', text: prompt },
  ];
}

/** Walk an arbitrary response object for the first video part. */
type VideoPart = { mimeType: string; data?: string; fileId?: string };

/** A content part, if it is a video with bytes or a file behind it. */
function videoPart(node: unknown): VideoPart | null {
  if (!node || typeof node !== 'object') return null;
  const rec = node as Record<string, unknown>;
  const mime = String(rec.mime_type ?? rec.mimeType ?? '');
  if (!(mime.startsWith('video/') || rec.type === 'video')) return null;
  const data = typeof rec.data === 'string' ? rec.data : undefined;
  const uri = typeof rec.uri === 'string' ? rec.uri : undefined;
  const fileId = uri ? uri.split('/').filter(Boolean).slice(-1)[0]?.replace(/:.*$/, '') : undefined;
  return data || fileId ? { mimeType: mime || 'video/mp4', data, fileId } : null;
}

/**
 * The generated video in an interaction.
 *
 * The REST response is a list of steps — the user's input echoed back, the
 * model's thinking, then its output — so the video that was MADE is looked for
 * in the last model_output step first. Only if that shape is absent is the whole
 * response walked, which is all this used to do: it would take whichever
 * video-shaped part it reached first, echoed inputs included.
 */
function findVideo(obj: unknown): VideoPart | null {
  const steps = (obj as { steps?: unknown } | null)?.steps;
  if (Array.isArray(steps)) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i] as { type?: string; content?: unknown } | null;
      if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
      for (const part of step.content) {
        const v = videoPart(part);
        if (v) return v;
      }
    }
  }
  const seen = new Set<unknown>();
  const stack: unknown[] = [obj];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    const v = videoPart(node);
    if (v) return v;
    for (const child of Object.values(node as Record<string, unknown>)) {
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return null;
}

export async function generateClip(input: GenerateClipInput, apiKey: string): Promise<GeneratedClip> {
  if (!apiKey) throw new OmniFlashError('omni-flash-not-configured', 'GOOGLE_API_KEY is not set on the server.', 503);

  const model = input.model || process.env.OMNI_FLASH_MODEL || 'gemini-omni-1.1-flash';
  let body: Record<string, unknown>;

  if (input.previousInteractionId) {
    // Follow-up / extend turn — keep it minimal (docs: model + previous_interaction_id
    // + input only). Adding response_format / generation_config here makes the model
    // restart instead of continuing, and it rejects an explicit video task alongside
    // previous_interaction_id. The output is cumulative: the whole video so far.
    body = {
      model,
      previous_interaction_id: input.previousInteractionId,
      input: input.prompt,
    };
  } else {
    body = {
      model,
      input: buildInput(input.prompt, input.references),
      response_format: {
        type: 'video',
        aspect_ratio: input.aspect === '1:1' ? '16:9' : input.aspect,
        resolution: input.resolution,
        delivery: 'uri',
      },
      generation_config: { video_config: { task: input.task } },
    };
  }

  let json: Record<string, unknown> = {};
  let ok = false;
  // Omni Flash (preview) rate-limits tightly — retry 429 / 5xx with backoff.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}/interactions`, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify(body),
    });
    json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) {
      ok = true;
      break;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 3) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 15000));
      continue;
    }
    const err = (json.error ?? {}) as Record<string, unknown>;
    throw new OmniFlashError(
      String(err.status ?? 'omni-flash-error'),
      String(err.message ?? `Interactions API returned ${res.status}`),
      res.status === 429 ? 429 : 502,
    );
  }
  if (!ok) throw new OmniFlashError('omni-flash-error', 'Interactions API kept failing after retries.');

  const status = String(json.status ?? '');
  if (status && status !== 'completed' && status !== 'succeeded') {
    throw new OmniFlashError('omni-flash-incomplete', `Interaction status: ${status}`);
  }

  const video = findVideo(json);
  const interactionId = String(json.id ?? json.interaction_id ?? '');
  if (!video || !interactionId) {
    throw new OmniFlashError('omni-flash-no-video', 'No video found in the Interactions API response.');
  }
  return {
    interactionId,
    mimeType: video.mimeType,
    base64: video.data,
    fileId: video.fileId,
  };
}

/**
 * Read a finished interaction's video back, inline.
 *
 * Google documents that GET /interactions/{id} returns the video as base64 even
 * when it was created with delivery "uri". That is the way round a generated file
 * that fails Google's processing ("The file failed to be processed"): the video
 * was made and only its file copy failed, so it is read again rather than
 * generated — and paid for — a second time.
 */
export async function fetchInteractionVideo(interactionId: string, apiKey: string): Promise<Buffer | null> {
  if (!interactionId) return null;
  const res = await fetch(`${BASE}/interactions/${encodeURIComponent(interactionId)}`, { headers: headers(apiKey) });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const video = json ? findVideo(json) : null;
  return video?.data ? Buffer.from(video.data, 'base64') : null;
}

/** For delivery=uri: wait until the generated file is ACTIVE, then return its bytes. */
export async function downloadFile(fileId: string, apiKey: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const id = fileId.replace(/^files\//, '');
  for (let attempt = 0; attempt < 60; attempt++) {
    const meta = await fetch(`${BASE}/files/${id}`, { headers: headers(apiKey) });
    const mj = (await meta.json().catch(() => ({}))) as Record<string, unknown>;
    const state = String(mj.state ?? '');
    if (state === 'ACTIVE' || state === '') break;
    if (state === 'FAILED') {
      // The file record says why it failed. The bare "processing failed" this
      // used to throw gave nobody anything to act on.
      const why = (mj.error as { message?: string } | undefined)?.message?.trim();
      throw new OmniFlashError(
        'omni-flash-file-failed',
        why
          ? `Google could not finish the generated video: ${why}`
          : 'Google could not finish the generated video and gave no reason — usually temporary, so try again.',
      );
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  const dl = await fetch(`${BASE}/files/${id}:download?alt=media`, { headers: headers(apiKey) });
  if (!dl.ok) throw new OmniFlashError('omni-flash-download', `File download returned ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  return { bytes: buf, mimeType: dl.headers.get('content-type') ?? 'video/mp4' };
}
