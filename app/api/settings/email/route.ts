export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getEmailSettings, saveEmailSettings } from '@/lib/email/settings';
import { isEncryptionAvailable } from '@/lib/crypto';
import { publicProviderRegistry, TRANSPORT_MODES, AUTH_METHODS } from '@/lib/email/providers';
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
    providers: publicProviderRegistry(),
    transportModes: TRANSPORT_MODES,
    authMethods: AUTH_METHODS,
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
      clearPassword: body.clearPassword,
      fromName: body.fromName,
      fromEmail: body.fromEmail,
      replyTo: body.replyTo,
      provider: body.provider,
      transportMode: body.transportMode,
      authMethod: body.authMethod,
      oauthClientId: body.oauthClientId,
      oauthTenantId: body.oauthTenantId,
      oauthClientSecret: body.oauthClientSecret,
      clearOauthClientSecret: body.clearOauthClientSecret,
      oauthRefreshToken: body.oauthRefreshToken,
      clearOauthRefreshToken: body.clearOauthRefreshToken,
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'email_settings.update',
      entityType: 'EmailSettings',
      entityId: saved.id,
      metadata: {
        enabled: saved.enabled,
        host: saved.host,
        provider: saved.provider,
        transportMode: saved.transportMode,
        authMethod: saved.authMethod,
        passwordChanged: !!(body.password && String(body.password).length > 0),
        passwordCleared: !!body.clearPassword,
        oauthClientSecretChanged: !!(body.oauthClientSecret && String(body.oauthClientSecret).length > 0),
        oauthClientSecretCleared: !!body.clearOauthClientSecret,
        oauthRefreshTokenChanged: !!(body.oauthRefreshToken && String(body.oauthRefreshToken).length > 0),
        oauthRefreshTokenCleared: !!body.clearOauthRefreshToken,
      },
      ...requestMeta(req),
    });
    return NextResponse.json(saved);
  } catch (err: any) {
    console.error('Email settings update error:', err?.message);
    return NextResponse.json({ error: err?.message ?? 'Failed to update email settings' }, { status: 500 });
  }
}
