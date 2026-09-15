export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { requireManage } from '@/lib/rbac';
import { requestMeta } from '@/lib/audit';
import { rejectIntake, AiApproveError, IntakeStateLockError } from '@/lib/ai-intake/approve';

type Params = { params: Promise<{ id: string }> };

// POST /api/ai-intake/:id/reject
export async function POST(request: Request, { params }: Params) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  try {
    const updated = await rejectIntake(
      id,
      typeof body?.reason === 'string' ? body.reason : null,
      { id: actor.id, email: actor.email, role: actor.role },
      requestMeta(request),
    );
    return NextResponse.json({ ok: true, intake: updated });
  } catch (err: any) {
    // A state-lock conflict (intake analyzing/approving/imported/rejected, or a
    // concurrent claim won the parent row) is a 409, not a 400.
    if (err instanceof IntakeStateLockError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const msg = err instanceof AiApproveError ? err.message : (err?.message || 'Reject failed');
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
