// Shared evidence-upload constraints (cold-review §2/§3).
// Single source of truth for the reserve route, the registration route, and the
// client offline queue so limits can never drift out of sync.

export const ALLOWED_EVIDENCE_MIME = new Set<string>([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_PIXEL_AREA = 100_000_000; // ~100 MP (10000x10000)
export const RESERVATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Presigned PUT URLs expire together with the reservation so the client only has
// one expiry to reason about; a stale reservation always forces a fresh reserve.
export const UPLOAD_URL_TTL_SECONDS = Math.floor(RESERVATION_TTL_MS / 1000);

// Dedicated storage prefix for raw, unwatermarked field-photo originals.
export const EVIDENCE_ORIGINAL_PREFIX = 'evidence/originals';

export function extForMime(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('heic')) return 'heic';
  if (m.includes('heif')) return 'heif';
  return 'jpg';
}
