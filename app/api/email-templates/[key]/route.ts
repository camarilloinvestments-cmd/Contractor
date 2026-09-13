export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getDefaultTemplate } from '@/lib/email/templates';
import { extractVariables } from '@/lib/email/render';
import { writeAudit, requestMeta } from '@/lib/audit';

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { key } = await params;
  let row: any = null;
  try {
    row = await prisma.emailTemplate.findUnique({ where: { key } });
  } catch {
    row = null;
  }
  if (row) return NextResponse.json(row);
  const def = getDefaultTemplate(key);
  if (!def) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ...def, isActive: true, isDefault: true });
}

// Upserts a template. Rejects bodies/subjects that reference disallowed variables.
export async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { key } = await params;
  try {
    const body = await req.json();
    const subject = String(body.subject ?? '');
    const bodyHtml = String(body.bodyHtml ?? '');
    const bodyText = body.bodyText != null ? String(body.bodyText) : null;
    const name = String(body.name ?? key);
    const isActive = body.isActive != null ? !!body.isActive : true;

    // Enforce the allow-list (ruling #10): reject any unknown variable token.
    const unknown = new Set<string>();
    for (const src of [subject, bodyHtml, bodyText ?? '']) {
      extractVariables(src).unknown.forEach((u) => unknown.add(u));
    }
    if (unknown.size > 0) {
      return NextResponse.json(
        { error: `Template references disallowed variables: ${[...unknown].join(', ')}` },
        { status: 400 }
      );
    }

    const saved = await prisma.emailTemplate.upsert({
      where: { key },
      create: { key, name, subject, bodyHtml, bodyText, isActive },
      update: { name, subject, bodyHtml, bodyText, isActive },
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'email_template.update',
      entityType: 'EmailTemplate',
      entityId: key,
      ...requestMeta(req),
    });
    return NextResponse.json(saved);
  } catch (err: any) {
    console.error('Template update error:', err?.message);
    return NextResponse.json({ error: 'Failed to save template' }, { status: 500 });
  }
}
