export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { buildQuoteSnapshot } from '@/lib/documents/snapshots';
import { getCompanyProfile } from '@/lib/branding';
import { getTemplate, TEMPLATE_KEYS } from '@/lib/email/templates';
import { renderTemplate } from '@/lib/email/render';
import { companyVariables, quoteVariables, mergeVariables } from '@/lib/email/variables';

// Returns EXACTLY the data the PDF renders (snapshot) plus the rendered email
// preview — guaranteeing preview/PDF/email parity.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { id } = await params;
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode'); // 'email' | null (document)

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: { primeContractor: true, project: true, salesperson: true, items: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const snapshot = buildQuoteSnapshot(quote);

  if (mode === 'email') {
    const branding = await getCompanyProfile();
    const tmpl = await getTemplate(TEMPLATE_KEYS.QUOTE_NEW);
    const vars = mergeVariables(companyVariables(branding), quoteVariables(quote));
    return NextResponse.json({
      email: {
        subject: renderTemplate(tmpl?.subject ?? 'Quote {{quote_number}}', vars),
        html: renderTemplate(tmpl?.bodyHtml ?? '<p>Quote {{quote_number}}</p>', vars),
        text: renderTemplate(tmpl?.bodyText ?? 'Quote {{quote_number}}', vars),
        to: quote.primeContractor?.email ?? null,
      },
    });
  }

  return NextResponse.json({ snapshot });
}
