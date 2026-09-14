export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { buildInvoiceSnapshot } from '@/lib/documents/snapshots';
import { getCompanyProfile } from '@/lib/branding';
import { getTemplate, TEMPLATE_KEYS } from '@/lib/email/templates';
import { renderTemplate } from '@/lib/email/render';
import { companyVariables, invoiceVariables, mergeVariables } from '@/lib/email/variables';

// Returns EXACTLY the data the PDF renders (snapshot) plus the rendered email
// preview — guaranteeing preview/PDF/email parity (requirement E).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode'); // 'email' | null (document)

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { primeContractor: true, items: true },
  });
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const snapshot = buildInvoiceSnapshot(invoice);

  if (mode === 'email') {
    const branding = await getCompanyProfile();
    const templateKey =
      invoice.emailCount > 0 ? TEMPLATE_KEYS.INVOICE_REMINDER : TEMPLATE_KEYS.INVOICE_NEW;
    const tmpl = await getTemplate(templateKey);
    const vars = mergeVariables(companyVariables(branding), invoiceVariables(invoice));
    return NextResponse.json({
      email: {
        subject: renderTemplate(tmpl?.subject ?? 'Invoice {{invoice_number}}', vars),
        html: renderTemplate(tmpl?.bodyHtml ?? '<p>Invoice {{invoice_number}}</p>', vars),
        text: renderTemplate(tmpl?.bodyText ?? 'Invoice {{invoice_number}}', vars),
        to: invoice.primeContractor?.email ?? null,
      },
    });
  }

  return NextResponse.json({ snapshot });
}
