export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { requireManage } from '@/lib/rbac';
import { requestMeta } from '@/lib/audit';
import { approveIntake, AiApproveError } from '@/lib/ai-intake/approve';

type Params = { params: Promise<{ id: string }> };

// POST /api/ai-intake/:id/approve -> create the Work Order + Tasks from operator decisions.
export async function POST(request: Request, { params }: Params) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  try {
    const result = await approveIntake(
      id,
      {
        jobName: body?.jobName,
        overrideVersionId: body?.overrideVersionId ?? null,
        itemDecisions: Array.isArray(body?.itemDecisions) ? body.itemDecisions : [],
      },
      { id: actor.id, email: actor.email, role: actor.role },
      requestMeta(request),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    const msg = err instanceof AiApproveError ? err.message : (err?.message || 'Approval failed');
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
