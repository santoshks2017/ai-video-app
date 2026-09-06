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
function ensure(): void {
  if (ready) return;
  if (!getApps().length) {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT, storageBucket: BUCKET });
  }
  ready = true;
}

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
}

export interface JobRecord {
  jobId: string;
  status: 'running' | 'done' | 'failed';
  createdAt: number;
  updatedAt: number;
  categories: string[];
  dealerName: string;
  aspect: string;
  resolution: string;
  totalSeconds: number;
  costInr: number;
  clips: JobClip[];
  error?: string;
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
