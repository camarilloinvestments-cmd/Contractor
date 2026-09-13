export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getCompanyProfile, upsertCompanyProfile } from '@/lib/branding';
import { writeAudit, requestMeta } from '@/lib/audit';

const EDITABLE = [
  'companyName', 'legalName', 'tagline', 'logoUrl', 'logoStoragePath', 'logoContentType',
  'address', 'city', 'state', 'zip',
  'phone', 'email', 'website', 'supportEmail', 'supportPhone', 'primaryColor', 'accentColor',
  'invoicePrefix', 'invoiceFooter', 'portalUrl',
] as const;

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const profile = await getCompanyProfile();
  return NextResponse.json(profile);
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      if (key in body) data[key] = body[key];
    }
    if (!data.companyName || String(data.companyName).trim().length === 0) {
      // companyName cannot be blanked out; drop it so the existing value stays.
      delete data.companyName;
    }
    const profile = await upsertCompanyProfile(data);
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'branding.update',
      entityType: 'CompanyProfile',
      entityId: profile.id,
      metadata: { fields: Object.keys(data) },
      ...requestMeta(req),
    });
    return NextResponse.json(profile);
  } catch (err: any) {
    console.error('Branding update error:', err?.message);
    return NextResponse.json({ error: 'Failed to update branding' }, { status: 500 });
  }
}
