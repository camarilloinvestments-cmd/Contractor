export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getCompanyProfile, upsertCompanyProfile } from '@/lib/branding';
import { saveLogo, deleteLogo, validateLogo, isS3Configured } from '@/lib/branding-storage';
import { writeAudit, requestMeta } from '@/lib/audit';

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') return null;
  return session;
}

// Upload a company logo. The file is streamed through the server (multipart
// form field "file") and persisted to S3 when configured, otherwise to local
// persistent storage (data/branding). Returns the fields to store on the
// CompanyProfile. ADMIN only. Type + size are validated before any write.
export async function POST(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    const contentType = file.type || '';
    const size = file.size ?? 0;
    const check = validateLogo(contentType, size);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveLogo(buffer, contentType);

    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'branding.logo.upload',
      entityType: 'CompanyProfile',
      entityId: 'default',
      metadata: { mode: isS3Configured() ? 's3' : 'local', contentType, size },
      ...requestMeta(req),
    });

    return NextResponse.json({
      logoUrl: saved.logoUrl,
      logoStoragePath: saved.logoStoragePath,
      logoContentType: saved.logoContentType,
      storageMode: isS3Configured() ? 's3' : 'local',
    });
  } catch (err: any) {
    console.error('Logo upload error:', err?.message);
    return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 });
  }
}

// Remove the current company logo: delete the stored object (local or S3) and
// clear the logo fields on the profile in a single call. ADMIN only.
export async function DELETE(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const profile = await getCompanyProfile();
    await deleteLogo(profile.logoStoragePath);
    const updated = await upsertCompanyProfile({
      logoUrl: null,
      logoStoragePath: null,
      logoContentType: null,
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'branding.logo.remove',
      entityType: 'CompanyProfile',
      entityId: 'default',
      ...requestMeta(req),
    });
    return NextResponse.json({ ok: true, profile: updated });
  } catch (err: any) {
    console.error('Logo remove error:', err?.message);
    return NextResponse.json({ error: 'Failed to remove logo' }, { status: 500 });
  }
}
