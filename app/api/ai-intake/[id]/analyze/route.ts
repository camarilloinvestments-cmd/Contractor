export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { requireManage } from '@/lib/rbac';
import { requestMeta } from '@/lib/audit';
import { analyzeIntake, AiIntakeError } from '@/lib/ai-intake/analyze';

type Params = { params: Promise<{ id: string }> };

// POST /api/ai-intake/:id/analyze -> explicit operator-triggered AI analysis.
export async function POST(request: Request, { params }: Params) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;
  const { id } = await params;

  try {
    const result = await analyzeIntake(
      id,
      { id: actor.id, email: actor.email, role: actor.role },
      requestMeta(request),
    );
    return NextResponse.json({ ok: true, intake: result });
  } catch (err: any) {
    const msg = err instanceof AiIntakeError ? err.message : (err?.message || 'Analysis failed');
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
