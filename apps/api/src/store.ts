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
  }
  ready = true;
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
  /** Frame grabbed from the finished video, for the history thumbnail. */
  posterPath?: string;
  status: 'running' | 'done' | 'failed';
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
  /* ---- refinement: a partial re-run of an earlier job ---- */
  /** The job this one was refined from — set only on refinements. */
  parentJobId?: string;
  /** Which part numbers were actually re-generated; the rest were re-used. */
  refinedParts?: number[];
  /** The reviewer's note that drove the retake. */
  feedback?: string;
}

export async function saveJob(rec: JobRecord): Promise<void> {
  ensure();
  await getFirestore().collection('generations').doc(rec.jobId).set(rec);
}

export async function updateJob(jobId: string, patch: Partial<JobRecord>): Promise<void> {
  ensure();
  await getFirestore()
    .collection('generations')
    .doc(jobId)
    .set({ ...patch, updatedAt: Date.now() }, { merge: true });
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

/* ---- reference images (P0.4 / P0.2): uploaded or scraped, grounded into the model ---- */

export async function putRef(
  filename: string,
  contentType: string,
  bytes: Buffer,
): Promise<{ refId: string; storagePath: string }> {
  ensure();
  const refId = crypto.randomUUID();
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'ref.jpg';
  const storagePath = `refs/${refId}/${safe}`;
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
