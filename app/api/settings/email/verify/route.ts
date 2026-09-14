export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { verifyTransport } from '@/lib/email/mailer';
import { writeAudit, requestMeta } from '@/lib/audit';

// Test Connection: verifies SMTP/transport connectivity and authentication
// WITHOUT sending a message. Returns a safe, categorized error on failure.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await verifyTransport();
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'email.verify',
      entityType: 'EmailSettings',
      metadata: { ok: result.ok, category: result.errorCategory ?? null },
      ...requestMeta(req),
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, category: result.errorCategory },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Email verify error:', err?.message);
    return NextResponse.json({ ok: false, error: 'Verification failed' }, { status: 500 });
  }
}
