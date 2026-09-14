export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { buildStatementSnapshot } from '@/lib/documents/snapshots';
import { getCompanyProfile } from '@/lib/branding';
import { getTemplate, TEMPLATE_KEYS } from '@/lib/email/templates';
import { renderTemplate } from '@/lib/email/render';
import { companyVariables, statementVariables, mergeVariables } from '@/lib/email/variables';

// Returns EXACTLY the data the PDF renders (snapshot) plus the rendered email
// preview — guaranteeing preview/PDF/email parity.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { id } = await params;
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode'); // 'email' | null (document)

  const statement = await prisma.statement.findUnique({
    where: { id },
    include: {
      primeContractor: true,
      project: true,
      lines: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!statement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const snapshot = buildStatementSnapshot(statement);

  if (mode === 'email') {
    const branding = await getCompanyProfile();
    const tmpl = await getTemplate(TEMPLATE_KEYS.STATEMENT_NEW);
    const vars = mergeVariables(companyVariables(branding), statementVariables(statement));
    return NextResponse.json({
      email: {
        subject: renderTemplate(tmpl?.subject ?? 'Statement {{statement_number}}', vars),
        html: renderTemplate(tmpl?.bodyHtml ?? '<p>Statement {{statement_number}}</p>', vars),
        text: renderTemplate(tmpl?.bodyText ?? 'Statement {{statement_number}}', vars),
        to: statement.primeContractor?.email ?? null,
      },
    });
  }

  const branding = await getCompanyProfile();
  return NextResponse.json({
    snapshot,
    branding: {
      companyName: branding.companyName,
      logoUrl: branding.logoUrl,
      address: branding.address,
      city: branding.city,
      state: branding.state,
      zip: branding.zip,
      phone: branding.phone,
      email: branding.email,
      website: branding.website,
      primaryColor: branding.primaryColor,
    },
  });
}
