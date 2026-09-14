// Branding logo storage abstraction (Phase 1.3 / v1.2.0-rc.1).
//
// Supports two interchangeable backends and picks automatically:
//   * S3 mode      — when AWS_BUCKET_NAME is configured, the logo is uploaded
//                    server-side to a public object and served from S3.
//   * Local mode   — fallback when no bucket is configured. The logo is written
//                    to <cwd>/data/branding, which is a persistent Docker volume
//                    (see docker-compose app_data). It therefore survives
//                    container recreation, rebuild, and restart, and is served
//                    back through /api/branding/logo/<name>.
//
// All uploads flow THROUGH the server (multipart), so the same validated path
// (type + size + safe filename) applies to both backends. No presigned browser
// PUT is used, which also removes the S3 CORS requirement for logo uploads.
import path from 'path';
import { promises as fs } from 'fs';
import { getBucketConfig } from './aws-config';

export const LOCAL_SCHEME = 'local:';
export const LOCAL_BRANDING_DIR = path.join(process.cwd(), 'data', 'branding');

export const ALLOWED_LOGO_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;

// Logos are small brand assets; cap uploads at 5 MB.
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export function isS3Configured(): boolean {
  return Boolean(getBucketConfig().bucketName);
}

export function extForContentType(ct: string): string {
  const c = (ct || '').toLowerCase();
  if (c.includes('svg')) return 'svg';
  if (c.includes('png')) return 'png';
  if (c.includes('jpeg') || c.includes('jpg')) return 'jpg';
  if (c.includes('gif')) return 'gif';
  if (c.includes('webp')) return 'webp';
  return 'png';
}

export function contentTypeForExt(ext: string): string {
  switch ((ext || '').toLowerCase()) {
    case 'svg': return 'image/svg+xml';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

export function validateLogo(contentType: string, size: number): { ok: true } | { ok: false; error: string } {
  const ct = (contentType || '').toLowerCase();
  if (!ALLOWED_LOGO_TYPES.includes(ct as any)) {
    return { ok: false, error: 'Unsupported image type. Use PNG, JPG, WEBP, GIF, or SVG.' };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'Empty file.' };
  }
  if (size > MAX_LOGO_BYTES) {
    return { ok: false, error: `Logo exceeds the ${Math.round(MAX_LOGO_BYTES / (1024 * 1024))} MB limit.` };
  }
  return { ok: true };
}

// Only local filenames matching this exact shape are ever read or written.
// This makes path traversal structurally impossible regardless of input.
const LOCAL_NAME_RE = /^logo-[0-9]+\.(png|jpg|jpeg|gif|webp|svg)$/;

export function isLocalStoragePath(p: string | null | undefined): boolean {
  return Boolean(p && p.startsWith(LOCAL_SCHEME));
}

// Extract and validate the bare filename from either a `local:<name>` storage
// path or a raw name coming off the serving route. Returns null when the name is
// not a well-formed, in-directory logo filename.
export function safeLocalFilename(input: string | null | undefined): string | null {
  if (!input) return null;
  let name = input.startsWith(LOCAL_SCHEME) ? input.slice(LOCAL_SCHEME.length) : input;
  name = path.basename(name); // strip any path components defensively
  if (!LOCAL_NAME_RE.test(name)) return null;
  // Final belt-and-suspenders: resolved path must stay inside the branding dir.
  const resolved = path.resolve(LOCAL_BRANDING_DIR, name);
  if (path.dirname(resolved) !== path.resolve(LOCAL_BRANDING_DIR)) return null;
  return name;
}

export type SavedLogo = {
  logoStoragePath: string;
  logoUrl: string;
  logoContentType: string;
};

// Persist logo bytes to the active backend and return the fields to store on the
// CompanyProfile. Caller must have validated auth + content already.
export async function saveLogo(buffer: Buffer, contentType: string): Promise<SavedLogo> {
  const ext = extForContentType(contentType);
  const filename = `logo-${Date.now()}.${ext}`;

  if (isS3Configured()) {
    const { uploadBuffer, getFileUrl } = await import('./s3');
    const { cloud_storage_path } = await uploadBuffer(buffer, filename, contentType, 'public/branding');
    const logoUrl = await getFileUrl(cloud_storage_path, contentType, true);
    return { logoStoragePath: cloud_storage_path, logoUrl, logoContentType: contentType };
  }

  await fs.mkdir(LOCAL_BRANDING_DIR, { recursive: true });
  const dest = path.join(LOCAL_BRANDING_DIR, filename);
  await fs.writeFile(dest, buffer);
  return {
    logoStoragePath: `${LOCAL_SCHEME}${filename}`,
    logoUrl: `/api/branding/logo/${filename}`,
    logoContentType: contentType,
  };
}

// Read a locally-stored logo for serving. Returns null on any validation/read
// failure so callers can respond 404 without leaking details.
export async function readLocalLogo(nameOrPath: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const name = safeLocalFilename(nameOrPath);
  if (!name) return null;
  try {
    const buffer = await fs.readFile(path.join(LOCAL_BRANDING_DIR, name));
    const ext = name.split('.').pop() || '';
    return { buffer, contentType: contentTypeForExt(ext) };
  } catch {
    return null;
  }
}

// Remove a previously-stored logo from whichever backend holds it. Best-effort:
// never throws, so profile updates are not blocked by a missing/foreign object.
export async function deleteLogo(logoStoragePath: string | null | undefined): Promise<void> {
  if (!logoStoragePath) return;
  try {
    if (isLocalStoragePath(logoStoragePath)) {
      const name = safeLocalFilename(logoStoragePath);
      if (name) await fs.unlink(path.join(LOCAL_BRANDING_DIR, name)).catch(() => {});
      return;
    }
    if (isS3Configured()) {
      const { deleteFile } = await import('./s3');
      await deleteFile(logoStoragePath).catch(() => {});
    }
  } catch {
    // swallow — deletion is best-effort
  }
}
