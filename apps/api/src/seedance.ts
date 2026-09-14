/**
 * Dreamina Seedance client (BytePlus ModelArk).
 *
 * Unlike Omni Flash's synchronous Interactions call, ModelArk video generation
 * is a task queue: POST a task, poll it, then download the finished file from a
 * short-lived TOS URL.
 *
 *   POST /api/v3/contents/generations/tasks      -> { id: "cgt-..." }
 *   GET  /api/v3/contents/generations/tasks/{id} -> { status, content.video_url }
 *
 * The reason to care: Seedance 2.5 renders up to 30 seconds in ONE pass with
 * native audio. Most dealer videos then need no stitching and no frame-seeding
 * at all — the whole class of cross-segment drift disappears.
 *
 * Docs: https://docs.byteplus.com/en/docs/ModelArk/1520757 (create)
 *       https://docs.byteplus.com/en/docs/ModelArk/1521309 (retrieve)
 *       https://docs.byteplus.com/en/docs/ModelArk/2607688 (2.5 capabilities)
 */

export const ARK_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';

export interface SeedanceRef {
  /** Raw base64, no data: prefix. */
  data: string;
  mimeType: string;
  /**
   * `first_frame` continues from the previous segment's closing frame;
   * `reference_image` grounds the subject (the car, the showroom).
   */
  role: 'first_frame' | 'last_frame' | 'reference_image';
}

export interface SeedanceInput {
  prompt: string;
  model: string;
  aspect: '9:16' | '1:1' | '16:9';
  resolution: '480p' | '720p' | '1080p';
  /** Seconds. Rounded to a whole number and clamped to the model's range. */
  duration: number;
  minSec: number;
  maxSec: number;
  references?: SeedanceRef[];
  /** Seedance renders speech and sound in the same pass. */
  generateAudio?: boolean;
  /** Called once for the request sent, so a day's spend is counted alongside Google's. */
  onAttempt?: () => void;
}

export interface SeedanceClip {
  taskId: string;
  bytes: Buffer;
  mimeType: string;
  /** What the service actually rendered, which may differ from what we asked. */
  seconds?: number;
}

export class SeedanceError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

const POLL_MS = 8000;
/** 30s of 720p video takes minutes; Cloud Run allows an hour. */
const MAX_WAIT_MS = 20 * 60 * 1000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function authHeaders(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
}

/** ModelArk errors arrive as {error:{code,message}} or {code,message}. */
function arkError(body: unknown, fallback: string): SeedanceError {
  const b = body as { error?: { code?: string; message?: string }; code?: string; message?: string };
  const code = b?.error?.code ?? b?.code ?? 'seedance-error';
  const message = b?.error?.message ?? b?.message ?? fallback;
  return new SeedanceError(String(code), String(message));
}

export async function generateSeedanceClip(
  input: SeedanceInput,
  apiKey: string,
): Promise<SeedanceClip> {
  const supplied = input.references ?? [];
  const hasFirstFrame = supplied.some((r) => r.role === 'first_frame' || r.role === 'last_frame');

  // ModelArk rejects a request that mixes the two kinds of input:
  //   "first/last frame content cannot be mixed with reference media content"
  // On a continuation segment the seed frame wins. It is what makes the cut
  // seamless, and being the previous segment's closing frame it already carries
  // the presenter, the car and the location — so the reference stills it
  // displaces add little. (Seedance 2.5 fits 30s in one call, where there is no
  // continuation segment and every reference image is sent.)
  const refs = hasFirstFrame
    ? supplied.filter((r) => r.role === 'first_frame' || r.role === 'last_frame')
    : supplied;

  const content: unknown[] = [
    { type: 'text', text: input.prompt },
    ...refs.map((r) => ({
      type: 'image_url',
      image_url: { url: `data:${r.mimeType};base64,${r.data}` },
      role: r.role,
    })),
  ];

  const body: Record<string, unknown> = {
    model: input.model,
    content,
    // A first_frame task must use `adaptive`; the output then inherits the seed
    // frame's shape, which is the previous segment's — so the aspect still holds.
    ratio: hasFirstFrame ? 'adaptive' : input.aspect,
    resolution: input.resolution,
    duration: Math.max(input.minSec, Math.min(input.maxSec, Math.round(input.duration))),
    generate_audio: input.generateAudio !== false,
    watermark: false,
    output_format: 'mp4',
  };
  // Only an omni-reference task takes this hint, and pinning it to `reference`
  // stops the model reading a shot description as an edit or extend request.
  if (!hasFirstFrame && refs.length) body.omni_reference_task_type = 'reference';

  input.onAttempt?.();
  const created = await fetch(`${ARK_BASE}/contents/generations/tasks`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const createdJson = (await created.json().catch(() => ({}))) as { id?: string };
  if (!created.ok) throw arkError(createdJson, `ModelArk returned ${created.status} creating the task.`);
  const taskId = createdJson.id;
  if (!taskId) throw new SeedanceError('seedance-no-task-id', 'ModelArk accepted the request but returned no task id.');

  const task = await pollTask(taskId, apiKey);
  const url = task.content?.video_url;
  if (!url) throw new SeedanceError('seedance-no-video', `Task ${taskId} succeeded but carried no video_url.`);

  const file = await fetch(url);
  if (!file.ok) {
    throw new SeedanceError('seedance-download-failed', `Could not download the finished video (${file.status}).`);
  }
  return {
    taskId,
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: file.headers.get('content-type') || 'video/mp4',
    seconds: task.duration,
  };
}

/**
 * Re-render a finished film through Seedance, keeping everything but the finish.
 *
 * Omni writes and speaks Hindi far better than Seedance does; Seedance renders a
 * more expensive-looking picture. So a film is made with Omni, approved by the
 * client, and only then passed through here — the same cut, the same people, the
 * same car, the same words, rendered better. ModelArk takes at most 30 seconds
 * in a pass, so a longer film arrives here in pieces and is joined again after.
 */
export async function enhanceSeedanceClip(
  input: {
    prompt: string;
    model: string;
    resolution: '480p' | '720p' | '1080p';
    /** A link ModelArk can fetch, preferred — a large video inline is often refused. */
    videoUrl?: string;
    /** Fallback: the video itself, base64. */
    videoData?: string;
    mimeType?: string;
    duration: number;
  },
  apiKey: string,
): Promise<SeedanceClip> {
  const url = input.videoUrl ?? `data:${input.mimeType ?? 'video/mp4'};base64,${input.videoData ?? ''}`;
  if (!input.videoUrl && !input.videoData) {
    throw new SeedanceError('seedance-no-source', 'Nothing to enhance — no video was supplied.');
  }

  const body: Record<string, unknown> = {
    model: input.model,
    content: [
      { type: 'text', text: input.prompt },
      { type: 'video_url', video_url: { url }, role: 'reference_video' },
    ],
    resolution: input.resolution,
    duration: Math.max(1, Math.round(input.duration)),
    // The sound is already right — it came from Omni — so nothing new is spoken.
    generate_audio: false,
    watermark: false,
    output_format: 'mp4',
    omni_reference_task_type: 'reference',
  };

  const created = await fetch(`${ARK_BASE}/contents/generations/tasks`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const createdJson = (await created.json().catch(() => ({}))) as { id?: string };
  if (!created.ok) throw arkError(createdJson, `ModelArk returned ${created.status} creating the enhance task.`);
  const taskId = createdJson.id;
  if (!taskId) throw new SeedanceError('seedance-no-task-id', 'ModelArk accepted the request but returned no task id.');

  const task = await pollTask(taskId, apiKey);
  const videoUrl = task.content?.video_url;
  if (!videoUrl) throw new SeedanceError('seedance-no-video', `Task ${taskId} succeeded but carried no video.`);
  const file = await fetch(videoUrl);
  if (!file.ok) {
    throw new SeedanceError('seedance-download-failed', `Could not download the enhanced video (${file.status}).`);
  }
  return {
    taskId,
    bytes: Buffer.from(await file.arrayBuffer()),
    mimeType: file.headers.get('content-type') || 'video/mp4',
    seconds: task.duration,
  };
}

interface ArkTask {
  status?: string;
  content?: { video_url?: string };
  duration?: number;
  error?: { code?: string; message?: string };
}

async function pollTask(taskId: string, apiKey: string): Promise<ArkTask> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let last = '';
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const res = await fetch(`${ARK_BASE}/contents/generations/tasks/${taskId}`, {
      headers: authHeaders(apiKey),
    });
    const json = (await res.json().catch(() => ({}))) as ArkTask;
    if (!res.ok) throw arkError(json, `ModelArk returned ${res.status} polling task ${taskId}.`);

    last = json.status ?? '';
    if (last === 'succeeded') return json;
    if (last === 'failed' || last === 'cancelled') {
      throw arkError(json, `Task ${taskId} ${last} without an error message.`);
    }
    // queued / running — keep waiting.
  }
  throw new SeedanceError(
    'seedance-timeout',
    `Task ${taskId} was still "${last || 'pending'}" after ${Math.round(MAX_WAIT_MS / 60000)} minutes.`,
    504,
  );
}

/**
 * Prove a key works without generating anything. Listing tasks is a free read,
 * so a wrong key, a wrong region or a blocked account surfaces here rather than
 * halfway through a paid run.
 */
export async function testSeedanceKey(apiKey: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${ARK_BASE}/contents/generations/tasks?page_size=1`, {
      headers: authHeaders(apiKey),
    });
    const json = (await res.json().catch(() => ({}))) as { total?: number };
    if (res.ok) {
      return { ok: true, detail: `Key accepted — ${json.total ?? 0} task(s) in the last 7 days.` };
    }
    const err = arkError(json, `ModelArk returned ${res.status}.`);
    return { ok: false, detail: `${err.code}: ${err.message}` };
  } catch (e) {
    return { ok: false, detail: `Could not reach ModelArk: ${(e as Error).message}` };
  }
}
