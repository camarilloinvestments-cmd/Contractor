export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { buildEstimateSnapshot } from '@/lib/documents/snapshots';
import { getCompanyProfile } from '@/lib/branding';
import { getTemplate, TEMPLATE_KEYS } from '@/lib/email/templates';
import { renderTemplate } from '@/lib/email/render';
import { companyVariables, estimateVariables, mergeVariables } from '@/lib/email/variables';

// Returns EXACTLY the data the PDF renders (snapshot) plus the rendered email
// preview — guaranteeing preview/PDF/email parity (requirements E & F).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { id } = await params;
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode'); // 'email' | null (document)

  const estimate = await prisma.estimate.findUnique({
    where: { id },
    include: { primeContractor: true, project: true, items: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!estimate) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const snapshot = buildEstimateSnapshot(estimate);

  if (mode === 'email') {
    const branding = await getCompanyProfile();
    const tmpl = await getTemplate(TEMPLATE_KEYS.ESTIMATE_NEW);
    const vars = mergeVariables(companyVariables(branding), estimateVariables(estimate));
    return NextResponse.json({
      email: {
        subject: renderTemplate(tmpl?.subject ?? 'Estimate {{estimate_number}}', vars),
        html: renderTemplate(tmpl?.bodyHtml ?? '<p>Estimate {{estimate_number}}</p>', vars),
        text: renderTemplate(tmpl?.bodyText ?? 'Estimate {{estimate_number}}', vars),
        to: estimate.primeContractor?.email ?? null,
      },
    });
  }

  return NextResponse.json({ snapshot });
}
