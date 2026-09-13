export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sendEmail } from '@/lib/email/mailer';
import { getTemplate, TEMPLATE_KEYS } from '@/lib/email/templates';
import { renderTemplate } from '@/lib/email/render';
import { getCompanyProfile } from '@/lib/branding';
import { companyVariables } from '@/lib/email/variables';
import { writeAudit, requestMeta } from '@/lib/audit';

// Sends a test email to the requested address using current SMTP settings.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const to = (body?.to as string) || session.user.email;
    if (!to) return NextResponse.json({ error: 'No recipient address' }, { status: 400 });

    const branding = await getCompanyProfile();
    const vars = companyVariables(branding);
    const tmpl = await getTemplate(TEMPLATE_KEYS.TEST);
    const subject = renderTemplate(tmpl?.subject ?? 'Test email from {{company_name}}', vars);
    const html = renderTemplate(tmpl?.bodyHtml ?? '<p>Test from {{company_name}}</p>', vars);
    const text = renderTemplate(tmpl?.bodyText ?? 'Test from {{company_name}}', vars);

    const result = await sendEmail({
      to,
      subject,
      html,
      text,
      templateKey: TEMPLATE_KEYS.TEST,
      relatedType: 'test',
      sentById: session.user.id,
    });

    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'email.test',
      entityType: 'EmailSettings',
      metadata: { to, ok: result.ok, error: result.error ?? null },
      ...requestMeta(req),
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, messageId: result.messageId });
  } catch (err: any) {
    console.error('Test email error:', err?.message);
    return NextResponse.json({ ok: false, error: err?.message ?? 'Failed to send test email' }, { status: 500 });
  }
}
