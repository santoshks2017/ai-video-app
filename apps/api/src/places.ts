/**
 * Google Business Profile import via the Places API (New).
 *
 * Given a Google Maps / GMB link (or a plain "name, city" query) this resolves
 * the place, pulls name / address / phone / website, and downloads up to a few
 * photos into the reference-image store so they can ground a generation.
 *
 * Authenticates as the Cloud Run runtime service account (ADC) — the Places API
 * rejects API keys of the Gemini `AQ.` form, and OAuth means there is no extra
 * key to store or rotate. The Places API must be enabled on the project.
 */

import { GoogleAuth } from 'google-auth-library';
import { putRef } from './store.js';
import type { StoredImage } from '@ava/shared';

const SEARCH = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS = 'https://places.googleapis.com/v1/places';
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT ?? 'ai-video-app-cd';

let auth: GoogleAuth | undefined;
async function authHeaders(): Promise<Record<string, string>> {
  auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const token = await auth.getAccessToken();
  if (!token) throw new PlacesError('places-no-credentials', 'No service-account credentials available.', 503);
  return { authorization: `Bearer ${token}`, 'X-Goog-User-Project': PROJECT };
}

export interface PlaceImport {
  placeId: string;
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  city?: string;
  rating?: number;
  photos: StoredImage[];
  note?: string;
}

export class PlacesError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

/** Pull a place id straight out of a Maps URL when it's there. */
export function placeIdFromUrl(url: string): string | undefined {
  const byParam = /[?&]place_id=([A-Za-z0-9_-]+)/.exec(url);
  if (byParam) return byParam[1];
  const byQ = /[?&]q=place_id:([A-Za-z0-9_-]+)/.exec(url);
  if (byQ) return byQ[1];
  const byCid = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(url);
  if (byCid) return undefined; // ftid, not a place id — fall through to text search
  return undefined;
}

/** Best-effort business name from a /place/<Name>/ path segment. */
export function queryFromUrl(url: string): string | undefined {
  const m = /\/place\/([^/@?]+)/.exec(url);
  if (!m?.[1]) return undefined;
  return decodeURIComponent(m[1]).replace(/\+/g, ' ').trim();
}

export async function importPlace(
  input: { url?: string; query?: string; maxPhotos?: number },
): Promise<PlaceImport> {
  const headers = await authHeaders();

  const url = input.url?.trim() ?? '';
  const explicitId = url ? placeIdFromUrl(url) : undefined;
  const query = input.query?.trim() || (url ? queryFromUrl(url) : undefined);

  let placeId = explicitId;
  if (!placeId) {
    if (!query) {
      throw new PlacesError(
        'places-no-query',
        "Couldn't read a business from that link. Paste the full Google Maps place URL, or type the business name and city.",
        400,
      );
    }
    const res = await fetch(SEARCH, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', 'X-Goog-FieldMask': 'places.id,places.displayName' },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      throw new PlacesError(
        'places-search-failed',
        json?.error?.message ?? `Places search returned ${res.status}`,
        res.status === 403 ? 403 : 502,
      );
    }
    placeId = json?.places?.[0]?.id;
    if (!placeId) throw new PlacesError('places-not-found', `No Google listing matched "${query}".`, 404);
  }

  const fields = [
    'id',
    'displayName',
    'formattedAddress',
    'nationalPhoneNumber',
    'internationalPhoneNumber',
    'websiteUri',
    'rating',
    'addressComponents',
    'photos',
  ].join(',');
  const dRes = await fetch(`${DETAILS}/${placeId}`, {
    headers: { ...headers, 'X-Goog-FieldMask': fields },
  });
  const d = (await dRes.json().catch(() => ({}))) as Record<string, any>;
  if (!dRes.ok) {
    throw new PlacesError(
      'places-details-failed',
      d?.error?.message ?? `Place details returned ${dRes.status}`,
      dRes.status === 403 ? 403 : 502,
    );
  }

  const name = d?.displayName?.text ?? query ?? 'Unknown';
  const city =
    (d?.addressComponents ?? []).find((c: any) => (c.types ?? []).includes('locality'))?.longText ??
    (d?.addressComponents ?? []).find((c: any) => (c.types ?? []).includes('administrative_area_level_2'))
      ?.longText;

  const photos: StoredImage[] = [];
  const wanted = Math.min(input.maxPhotos ?? 4, (d?.photos ?? []).length);
  for (let i = 0; i < wanted; i++) {
    const ref = d.photos[i]?.name; // "places/<id>/photos/<ref>"
    if (!ref) continue;
    try {
      const media = await fetch(
        `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=1600&skipHttpRedirect=true`,
        { headers },
      );
      const mj = (await media.json().catch(() => ({}))) as Record<string, any>;
      const uri = mj?.photoUri;
      if (!uri) continue;
      const img = await fetch(uri);
      if (!img.ok) continue;
      const bytes = Buffer.from(await img.arrayBuffer());
      const label = `${name} — showroom photo ${i + 1}`;
      const filename = `gmb_${slug(name)}_${i + 1}.jpg`;
      const { refId, storagePath } = await putRef(filename, 'image/jpeg', bytes);
      photos.push({ refId, storagePath, label, filename, url: `/api/refs/${refId}/${filename}` });
    } catch {
      /* skip a bad photo, keep the import */
    }
  }

  return {
    placeId: placeId!,
    name,
    address: d?.formattedAddress,
    phone: d?.nationalPhoneNumber ?? d?.internationalPhoneNumber,
    website: d?.websiteUri,
    city,
    rating: d?.rating,
    photos,
    note: photos.length ? undefined : 'Listing found, but no photos were available to import.',
  };
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'place';
