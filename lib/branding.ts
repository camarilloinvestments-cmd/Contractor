// Company branding / white-label foundation (Phase 1 / v1.1.0).
//
// Single-company model: a singleton CompanyProfile row (id = "default").
// Multi-tenant branding is intentionally deferred; callers use getCompanyProfile()
// and never assume more than one profile. Defaults mirror the schema defaults so
// the app renders correctly even before the row is seeded.
import { prisma } from '@/lib/prisma';

export const DEFAULT_PROFILE_ID = 'default';

export type CompanyBranding = {
  id: string;
  companyName: string;
  legalName: string | null;
  tagline: string | null;
  logoUrl: string | null;
  logoStoragePath: string | null;
  logoContentType: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  primaryColor: string;
  accentColor: string;
  invoicePrefix: string | null;
  invoiceFooter: string | null;
  portalUrl: string | null;
};

export const FALLBACK_BRANDING: CompanyBranding = {
  id: DEFAULT_PROFILE_ID,
  companyName: 'OS1 Fiber Track Pro',
  legalName: null,
  tagline: 'Fiber Construction Services',
  logoUrl: null,
  logoStoragePath: null,
  logoContentType: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  phone: null,
  email: null,
  website: null,
  supportEmail: null,
  supportPhone: null,
  primaryColor: '#1e40af',
  accentColor: '#0891b2',
  invoicePrefix: 'INV',
  invoiceFooter: 'Thank you for your business',
  portalUrl: null,
};

// Fetch the singleton company profile, returning safe defaults if not yet seeded.
export async function getCompanyProfile(): Promise<CompanyBranding> {
  try {
    const row = await prisma.companyProfile.findUnique({ where: { id: DEFAULT_PROFILE_ID } });
    if (!row) return FALLBACK_BRANDING;
    return row as CompanyBranding;
  } catch {
    // If the table does not yet exist (pre-migration) fall back gracefully.
    return FALLBACK_BRANDING;
  }
}

// Create-or-update the singleton profile.
export async function upsertCompanyProfile(
  data: Partial<Omit<CompanyBranding, 'id'>>
): Promise<CompanyBranding> {
  const row = await prisma.companyProfile.upsert({
    where: { id: DEFAULT_PROFILE_ID },
    create: { id: DEFAULT_PROFILE_ID, ...data },
    update: { ...data },
  });
  return row as CompanyBranding;
}

// Retrieve the company logo as raw bytes for server-side packaging (KMZ, PDF,
// email). Prefers an uploaded logo (logoStoragePath -> S3 GetObject) and falls
// back to fetching an external logoUrl over HTTP. Returns null when no logo is
// configured or retrieval fails (callers must render gracefully without a logo).
export async function getBrandingLogoBytes(
  branding?: CompanyBranding
): Promise<{ buffer: Buffer; contentType: string; ext: string } | null> {
  const b = branding ?? (await getCompanyProfile());
  const extFor = (ct: string): string => {
    if (ct.includes('png')) return 'png';
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
    if (ct.includes('gif')) return 'gif';
    if (ct.includes('webp')) return 'webp';
    if (ct.includes('svg')) return 'svg';
    return 'png';
  };
  try {
    if (b.logoStoragePath && b.logoStoragePath.startsWith('local:')) {
      // Local persistent-storage fallback (no S3 configured).
      const { readLocalLogo } = await import('./branding-storage');
      const local = await readLocalLogo(b.logoStoragePath);
      if (local) {
        const ct = b.logoContentType || local.contentType || 'image/png';
        return { buffer: local.buffer, contentType: ct, ext: extFor(ct) };
      }
    }
    if (b.logoStoragePath && !b.logoStoragePath.startsWith('local:')) {
      // Lazy-import so client bundles never pull in the S3 SDK.
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { createS3Client, getBucketConfig } = await import('./aws-config');
      const { bucketName } = getBucketConfig();
      if (bucketName) {
        const s3 = createS3Client();
        const res = await s3.send(
          new GetObjectCommand({ Bucket: bucketName, Key: b.logoStoragePath })
        );
        const bytes = await res.Body?.transformToByteArray();
        if (bytes) {
          const ct = b.logoContentType || res.ContentType || 'image/png';
          return { buffer: Buffer.from(bytes), contentType: ct, ext: extFor(ct) };
        }
      }
    }
    if (b.logoUrl) {
      const res = await fetch(b.logoUrl);
      if (res.ok) {
        const ct = res.headers.get('content-type') || b.logoContentType || 'image/png';
        const ab = await res.arrayBuffer();
        return { buffer: Buffer.from(ab), contentType: ct, ext: extFor(ct) };
      }
    }
  } catch {
    // fall through -> null
  }
  return null;
}
