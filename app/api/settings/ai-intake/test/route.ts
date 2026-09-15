export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/rbac';
import { getAiIntakeSettingsRaw, getDecryptedApiKey } from '@/lib/ai-intake/settings';
import { testConnection } from '@/lib/ai-intake/openai';

// POST /api/settings/ai-intake/test  (ADMIN only) -> live connectivity check
export async function POST() {
  const gate = await requireAdmin();
  if ('res' in gate) return gate.res;

  const row = await getAiIntakeSettingsRaw();
  if (!row) return NextResponse.json({ ok: false, error: 'Settings not configured' }, { status: 400 });
  const apiKey = getDecryptedApiKey(row);
  if (!apiKey) return NextResponse.json({ ok: false, error: 'No API key configured' }, { status: 400 });

  // Blocker 1: pass the stored base through the server-side endpoint guard. A
  // legacy/tampered non-official base is rejected before the key is ever sent.
  const result = await testConnection({
    apiKey,
    apiBase: row.apiBase,
    model: row.normalModel,
  });
  return NextResponse.json(result);
}
