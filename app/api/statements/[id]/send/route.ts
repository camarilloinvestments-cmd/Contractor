export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import { StatementPDF } from '@/components/document-pdf';
import { resolveBrandingForPdf } from '@/lib/documents/pdf';
import { getCompanyProfile } from '@/lib/branding';
import { getTemplate, TEMPLATE_KEYS } from '@/lib/email/templates';
import { renderTemplate } from '@/lib/email/render';
import { companyVariables, statementVariables, mergeVariables } from '@/lib/email/variables';
import { sendEmail } from '@/lib/email/mailer';
import { buildStatementSnapshot, createRevision, recordSend } from '@/lib/documents/snapshots';
import { writeAudit, requestMeta } from '@/lib/audit';

// Send (or resend) a statement. Creates a NEW immutable revision + snapshot,
// then records append-only send evidence (never overwrites prior sends).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { user } = gate;
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const statement = await prisma.statement.findUnique({
      where: { id },
      include: {
        primeContractor: true,
        project: true,
        lines: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!statement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const to = (body?.to as string) || statement.primeContractor?.email || '';
    if (!to) {
      return NextResponse.json(
        { error: 'No recipient email. Add an email to the prime contractor or provide one.' },
        { status: 400 }
      );
    }
    const cc = (body?.cc as string) || null;
    const bcc = (body?.bcc as string) || null;

    // Immutable revision captured at send time (this is exactly what the PDF shows).
    const snapshot = buildStatementSnapshot(statement);
    const revision = await createRevision('STATEMENT', id, snapshot, user.id);

    const branding = await resolveBrandingForPdf();
    const pdfBuffer = await renderToBuffer(
      React.createElement(StatementPDF, { statement: statement as any, branding }) as any
    );

    const profile = await getCompanyProfile();
    const templateKey = TEMPLATE_KEYS.STATEMENT_NEW;
    const tmpl = await getTemplate(templateKey);
    const vars = mergeVariables(companyVariables(profile), statementVariables(statement));
    const subject = renderTemplate(tmpl?.subject ?? 'Statement {{statement_number}}', vars);
    const html = renderTemplate(tmpl?.bodyHtml ?? '<p>Statement {{statement_number}}</p>', vars);
    const text = renderTemplate(tmpl?.bodyText ?? 'Statement {{statement_number}}', vars);

    const result = await sendEmail({
      to,
      cc,
      bcc,
      subject,
      html,
      text,
      templateKey,
      relatedType: 'statement',
      relatedId: statement.id,
      sentById: user.id,
      attachments: [
        { filename: `${statement.statementNumber}.pdf`, content: pdfBuffer as Buffer, contentType: 'application/pdf' },
      ],
    });

    // Append-only send evidence — recorded whether success OR failure.
    await recordSend({
      documentType: 'STATEMENT',
      documentId: statement.id,
      revisionId: revision.id,
      toAddress: to,
      ccAddress: cc,
      bccAddress: bcc,
      subject,
      sentById: user.id,
      provider: result.provider ?? null,
      providerMessageId: result.messageId ?? null,
      success: result.ok,
      failureCategory: result.ok ? null : result.errorCategory ?? null,
      failureMessage: result.ok ? null : result.error ?? null,
    });

    if (!result.ok) {
      await writeAudit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: 'statement.send.failed',
        entityType: 'Statement',
        entityId: statement.id,
        metadata: { to, error: result.error ?? null },
        ...requestMeta(req),
      });
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }

    const updated = await prisma.statement.update({
      where: { id: statement.id },
      data: {
        status: statement.status === 'DRAFT' ? 'SENT' : statement.status,
        lastEmailedAt: new Date(),
        emailCount: { increment: 1 },
        currentRevision: revision.revision,
      },
    });

    await writeAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: statement.emailCount > 0 ? 'statement.resend' : 'statement.send',
      entityType: 'Statement',
      entityId: statement.id,
      metadata: { to, revision: revision.revision, messageId: result.messageId ?? null },
      ...requestMeta(req),
    });

    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      revision: revision.revision,
      statement: { id: updated.id, status: updated.status, emailCount: updated.emailCount },
    });
  } catch (err: any) {
    console.error('Statement send error:', err?.message);
    return NextResponse.json({ ok: false, error: err?.message ?? 'Failed to send statement' }, { status: 500 });
  }
}
