export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getEmailSettings, saveEmailSettings } from '@/lib/email/settings';
import { isEncryptionAvailable } from '@/lib/crypto';
import { writeAudit, requestMeta } from '@/lib/audit';

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await getEmailSettings();
  return NextResponse.json({
    settings: settings ?? null,
    encryptionAvailable: isEncryptionAvailable(),
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const saved = await saveEmailSettings({
      enabled: body.enabled,
      host: body.host,
      port: body.port != null ? Number(body.port) : undefined,
      secure: body.secure,
      username: body.username,
      password: body.password, // plaintext; empty keeps existing
      clearPassword: !!body.clearPassword,
      fromName: body.fromName,
      fromEmail: body.fromEmail,
      replyTo: body.replyTo,
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'email_settings.update',
      entityType: 'EmailSettings',
      entityId: saved.id,
      metadata: {
        enabled: saved.enabled,
        host: saved.host,
        passwordChanged: !!body.password,
        passwordCleared: !!body.clearPassword,
      },
      ...requestMeta(req),
    });
    return NextResponse.json(saved);
  } catch (err: any) {
    console.error('Email settings update error:', err?.message);
    return NextResponse.json({ error: err?.message ?? 'Failed to update email settings' }, { status: 500 });
  }
}
