export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import { InvoicePDF } from '@/components/invoice-pdf';
import { getCompanyProfile } from '@/lib/branding';
import { getTemplate, TEMPLATE_KEYS } from '@/lib/email/templates';
import { renderTemplate } from '@/lib/email/render';
import { companyVariables, invoiceVariables, mergeVariables } from '@/lib/email/variables';
import { sendEmail } from '@/lib/email/mailer';
import { writeAudit, requestMeta } from '@/lib/audit';

// Sends (or resends) an invoice by email with a branded PDF attached.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { primeContractor: true, items: true },
    });
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const to = (body?.to as string) || invoice.primeContractor?.email;
    if (!to) {
      return NextResponse.json(
        { error: 'No recipient email. Add an email to the prime contractor or provide one.' },
        { status: 400 }
      );
    }

    const branding = await getCompanyProfile();

    // Branded PDF attachment.
    const pdfBuffer = await renderToBuffer(
      React.createElement(InvoicePDF, { invoice: invoice as any, branding: branding as any }) as any
    );

    // Choose reminder vs new based on whether it was already emailed (or override).
    const templateKey =
      (body?.templateKey as string) ||
      (invoice.emailCount > 0 ? TEMPLATE_KEYS.INVOICE_REMINDER : TEMPLATE_KEYS.INVOICE_NEW);
    const tmpl = await getTemplate(templateKey);
    const vars = mergeVariables(companyVariables(branding), invoiceVariables(invoice));
    const subject = renderTemplate(tmpl?.subject ?? 'Invoice {{invoice_number}}', vars);
    const html = renderTemplate(tmpl?.bodyHtml ?? '<p>Invoice {{invoice_number}}</p>', vars);
    const text = renderTemplate(tmpl?.bodyText ?? 'Invoice {{invoice_number}}', vars);

    const result = await sendEmail({
      to,
      subject,
      html,
      text,
      templateKey,
      relatedType: 'invoice',
      relatedId: invoice.id,
      sentById: session.user.id,
      attachments: [
        {
          filename: `${invoice.invoiceNumber}.pdf`,
          content: pdfBuffer as Buffer,
          contentType: 'application/pdf',
        },
      ],
    });

    if (!result.ok) {
      await writeAudit({
        actor: { id: session.user.id, email: session.user.email, role: session.user.role },
        action: 'invoice.send.failed',
        entityType: 'Invoice',
        entityId: invoice.id,
        metadata: { to, templateKey, error: result.error ?? null },
        ...requestMeta(req),
      });
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }

    // Mark as sent and bump counters.
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: invoice.status === 'DRAFT' ? 'SENT' : invoice.status,
        lastEmailedAt: new Date(),
        emailCount: { increment: 1 },
      },
    });

    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: invoice.emailCount > 0 ? 'invoice.resend' : 'invoice.send',
      entityType: 'Invoice',
      entityId: invoice.id,
      metadata: { to, templateKey, messageId: result.messageId ?? null },
      ...requestMeta(req),
    });

    return NextResponse.json({ ok: true, messageId: result.messageId, invoice: { id: updated.id, status: updated.status, emailCount: updated.emailCount, lastEmailedAt: updated.lastEmailedAt } });
  } catch (err: any) {
    console.error('Invoice send error:', err?.message);
    return NextResponse.json({ ok: false, error: err?.message ?? 'Failed to send invoice' }, { status: 500 });
  }
}
