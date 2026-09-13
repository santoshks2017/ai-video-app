/**
 * Firestore (job records) + Cloud Storage (generated clips) via the Admin SDK.
 * On Cloud Run this auto-authenticates as the runtime service account — no key.
 * Storage stays private; clips are served back through GET /api/clips/:jobId/:part.
 */

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT ?? 'ai-video-app-cd';
const BUCKET = process.env.STORAGE_BUCKET ?? `${PROJECT}.firebasestorage.app`;

let ready = false;
export function ensureFirebase(): void {
  if (ready) return;
  if (!getApps().length) {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT, storageBucket: BUCKET });
    // An optional field left unset must never sink a whole write.
    try {
      getFirestore().settings({ ignoreUndefinedProperties: true });
    } catch {
      /* already configured */
    }
  }
  ready = true;
}

/**
 * Firestore refuses `undefined` anywhere in a document. Every run since
 * renderResolution was added without a value (no upscale) failed its first save,
 * and a later merge-write left a record with no project, so the video vanished
 * from its project's history. Unset optional fields are dropped instead.
 */
function defined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(defined) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, defined(v)]),
    ) as T;
  }
  return value;
}
const ensure = ensureFirebase;

export interface JobClip {
  partNum: number;
  totalParts: number;
  seconds: number;
  start: number;
  end: number;
  interactionId: string;
  storagePath: string;
  status: 'pending' | 'done' | 'failed';
  error?: string;
  /** Carried over from an earlier job rather than generated — costs nothing. */
  reused?: boolean;
  /** Wall-clock time the provider took for this segment. Feeds the next run's ETA. */
  renderMs?: number;
}

export interface JobRecord {
  jobId: string;
  /** Who ran it. Every paid action is attributable to a named account. */
  userId?: string;
  userEmail?: string;
  userName?: string;
  /** Which project this generation belongs to — the key to project history. */
  projectId?: string;
  projectName?: string;
  /** Human label for the history list, e.g. "27s · Product Feature". */
  label?: string;
  modelName?: string;
  /** Provider model id — names get edited, ids do not, and the ETA groups runs by model. */
  modelId?: string;
  /** Frame grabbed from the finished video, for the history thumbnail. */
  posterPath?: string;
  /** The film's one continuous music track, kept so a retake lays the same bed back. */
  musicStoragePath?: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  /** Set by the Stop button. The run puts down its tools after the part it is on. */
  cancelRequested?: boolean;
  createdAt: number;
  updatedAt: number;
  categories: string[];
  dealerName: string;
  aspect: string;
  resolution: string;
  totalSeconds: number;
  costInr: number;
  costUsd?: number;
  usdPerSecond?: number;
  clips: JobClip[];
  /** The single finished video (a run's cumulative clip, or the ffmpeg-stitched result). */
  finalStoragePath?: string;
  error?: string;
  /**
   * When rendering began and when the finished video was saved — the source of
   * "took 4m 12s" in history, and of the estimate shown on the next run.
   */
  startedAt?: number;
  finishedAt?: number;
  /** The resolution the model rendered at, when the deliverable was upscaled from it. */
  renderResolution?: string;
  /* ---- refinement: a partial re-run of an earlier job ---- */
  /** The job this one was refined from — set only on refinements. */
  parentJobId?: string;
  /** Which part numbers were actually re-generated; the rest were re-used. */
  refinedParts?: number[];
  /** The reviewer's note that drove the retake. */
  feedback?: string;

  /* ---- provenance: what this run was made from ----
   *
   * A finished video on its own cannot answer "why is the car wrong" or "what
   * did I change since the good one". These fields are the run's receipt: the
   * brief it was built from, the prompt each part was given, and the reference
   * images each part was actually shown. They are also what an older run is
   * re-opened from, so a good video can be tweaked instead of rebuilt.
   */
  /** The brief, as composed for this run. Image bytes are not here — only their paths. */
  brief?: unknown;
  /** Storyboard edits in force for this run. */
  sceneEdits?: unknown;
  /** The prompt sent for each part. */
  prompts?: { part: number; text: string }[];
  /** The reference images each part was shown, by filename. */
  referenceFiles?: { part: number; files: string[] }[];
  /** Which vehicle the film was supposed to show, and where its photos came from. */
  vehicle?: { model?: string; colour?: string; photos: number; attached: boolean; angles: string[] };
  /** The project exactly as it stood when this ran — what "restore this version" puts back. */
  projectSnapshot?: unknown;
  /** What the vehicle checker made of each part, and whether it was made again. */
  vehicleChecks?: { part: number; same: boolean; why: string; remade?: boolean }[];
  /**
   * What each join measured: the dead air trimmed off either side, and how alike
   * the end of the part before sounds to the start of this one — the signature a
   * word said twice across a cut would leave.
   */
  joins?: { part: number; headTrim: number; tailTrim: number; echo?: number }[];

  /* ---- versions of a film, after it has been made ---- */
  /**
   * How this video came about. A generation is the film being made; everything
   * else is a version of one that already exists, and never replaces it.
   */
  kind?: 'generate' | 'retake' | 'restitch' | 'enhance' | 'upscale' | 'edit';
  /** Signed off by the client. The one that ships, and the one versions are cut from. */
  approved?: boolean;
  approvedAt?: number;
  /** Set on a version: what it was made from, and what was done to it. */
  derivedFrom?: string;
  derivedNote?: string;
  /**
   * Taken out of history and out of what the team has spent.
   *
   * A run that failed on someone else's billing, or was made twice by mistake,
   * is still a real record — it is not deleted, it stops being counted. Only an
   * admin can do it, and only an admin can see what has been done.
   */
  hidden?: boolean;
  hiddenAt?: number;
  hiddenBy?: string;
}

/** The newest generations across every project — the history an ETA is learned from. */
export async function listRecentJobs(limit = 200): Promise<JobRecord[]> {
  ensure();
  const snap = await getFirestore().collection('generations').orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data() as JobRecord);
}

export async function saveJob(rec: JobRecord): Promise<void> {
  ensure();
  await getFirestore().collection('generations').doc(rec.jobId).set(defined(rec));
}

export async function updateJob(jobId: string, patch: Partial<JobRecord>): Promise<void> {
  ensure();
  await getFirestore()
    .collection('generations')
    .doc(jobId)
    .set(defined({ ...patch, updatedAt: Date.now() }), { merge: true });
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  ensure();
  const snap = await getFirestore().collection('generations').doc(jobId).get();
  return snap.exists ? (snap.data() as JobRecord) : null;
}

export async function uploadClip(
  jobId: string,
  partNum: number,
  bytes: Buffer,
  mimeType: string,
): Promise<string> {
  ensure();
  const path = `generations/${jobId}/part-${partNum}.mp4`;
  await getStorage()
    .bucket(BUCKET)
    .file(path)
    .save(bytes, { contentType: mimeType || 'video/mp4', resumable: false });
  return path;
}

export async function streamClip(
  storagePath: string,
): Promise<{ stream: NodeJS.ReadableStream; contentType: string; size: number } | null> {
  ensure();
  const file = getStorage().bucket(BUCKET).file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [meta] = await file.getMetadata();
  return {
    stream: file.createReadStream(),
    contentType: String(meta.contentType ?? 'video/mp4'),
    size: Number(meta.size ?? 0),
  };
}

/**
 * A time-limited public link to something in the bucket.
 *
 * A provider that takes a video as input has to be able to fetch it, and the
 * app's own clip route is behind sign-in. Signing needs the service account to
 * be allowed to sign blobs; where it is not, the caller falls back to sending
 * the bytes inline.
 */
export async function signedUrlFor(storagePath: string, minutes = 120): Promise<string | null> {
  ensure();
  try {
    const [url] = await getStorage()
      .bucket(BUCKET)
      .file(storagePath)
      .getSignedUrl({ action: 'read', expires: Date.now() + minutes * 60_000, version: 'v4' });
    return url;
  } catch {
    return null;
  }
}

/* ---- reference images (P0.4 / P0.2): uploaded or scraped, grounded into the model ---- */

/**
 * The name a reference image is stored under. Uploads arrive with names like
 * "WhatsApp Image 2026-09-10 at 20.07.53 (1).jpeg"; storage keeps only safe
 * characters. Saving and loading must agree on this, or every such image
 * uploads fine and then 404s the moment anything asks for it by name.
 */
export const safeRefName = (filename: string): string =>
  filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'ref.jpg';

export async function putRef(
  filename: string,
  contentType: string,
  bytes: Buffer,
): Promise<{ refId: string; storagePath: string }> {
  ensure();
  const refId = crypto.randomUUID();
  const storagePath = `refs/${refId}/${safeRefName(filename)}`;
  await getStorage()
    .bucket(BUCKET)
    .file(storagePath)
    .save(bytes, { contentType: contentType || 'image/jpeg', resumable: false });
  return { refId, storagePath };
}

export async function readObject(
  storagePath: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  ensure();
  const file = getStorage().bucket(BUCKET).file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [meta] = await file.getMetadata();
  const [bytes] = await file.download();
  return { bytes, contentType: String(meta.contentType ?? 'application/octet-stream') };
}

/** Every generation record, by document id — for the repair of runs whose first save was lost. */
export async function listAllJobDocs(): Promise<JobRecord[]> {
  ensure();
  const snap = await getFirestore().collection('generations').get();
  return snap.docs.map((d) => ({ ...(d.data() as JobRecord), jobId: (d.data() as JobRecord).jobId ?? d.id }));
}

/** Every generation for a project, newest first. */
export async function listJobsForProject(projectId: string, limit = 50): Promise<JobRecord[]> {
  ensureFirebase();
  // Filter only — sorting in memory avoids needing a composite index for what is
  // a handful of rows per project.
  const snap = await getFirestore()
    .collection('generations')
    .where('projectId', '==', projectId)
    .limit(limit)
    .get();
  return snap.docs
    .map((d) => d.data() as JobRecord)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
