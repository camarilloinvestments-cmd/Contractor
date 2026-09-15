export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { writeAudit, requestMeta } from '@/lib/audit';
import { requireAdmin } from '@/lib/rbac';
import { isEncryptionAvailable } from '@/lib/crypto';
import { getAiIntakeSettings, saveAiIntakeSettings } from '@/lib/ai-intake/settings';

// GET /api/settings/ai-intake  (ADMIN only) -> masked settings, never the key
export async function GET() {
  const gate = await requireAdmin();
  if ('res' in gate) return gate.res;
  const settings = await getAiIntakeSettings();
  return NextResponse.json({ settings, encryptionAvailable: isEncryptionAvailable() });
}

// PUT /api/settings/ai-intake  (ADMIN only)
// Body: { enabled, apiKey?: { password, clear }, apiBase?, normalModel?, fallbackModel? }
export async function PUT(request: Request) {
  const gate = await requireAdmin();
  if ('res' in gate) return gate.res;
  const actor = gate.user;

  const body = await request.json().catch(() => ({}));
  // apiKey arrives as a SecretCredentialValue { password, clear } from the form.
  const cred = body.apiKey && typeof body.apiKey === 'object' ? body.apiKey : null;
  try {
    const settings = await saveAiIntakeSettings({
      enabled: !!body.enabled,
      apiKey: cred && typeof cred.password === 'string' && cred.password.length > 0 ? cred.password : undefined,
      clearApiKey: cred?.clear === true,
      apiBase: typeof body.apiBase === 'string' ? body.apiBase : undefined,
      normalModel: typeof body.normalModel === 'string' ? body.normalModel : undefined,
      fallbackModel: typeof body.fallbackModel === 'string' ? body.fallbackModel : undefined,
    });
    await writeAudit({
      actor, action: 'ai_settings.update', entityType: 'AiIntakeSettings', entityId: 'default',
      metadata: { enabled: settings.enabled, normalModel: settings.normalModel, fallbackModel: settings.fallbackModel },
      ...requestMeta(request),
    });
    return NextResponse.json({ settings });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to save settings' }, { status: 400 });
  }
}
