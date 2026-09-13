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
  companyName: 'FiberTrack Pro',
  legalName: null,
  tagline: 'Fiber Construction Services',
  logoUrl: null,
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
