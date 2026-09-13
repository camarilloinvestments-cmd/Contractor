export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { DEFAULT_TEMPLATES } from '@/lib/email/templates';
import { ALLOWED_VARIABLES } from '@/lib/email/allowlist';

// Lists templates. Merges DB rows over the built-in defaults so the UI always
// shows the full known set even before seeding.
export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let rows: any[] = [];
  try {
    rows = await prisma.emailTemplate.findMany({ orderBy: { name: 'asc' } });
  } catch {
    rows = [];
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const merged = DEFAULT_TEMPLATES.map((d) => {
    const row = byKey.get(d.key);
    return row
      ? { ...row, isDefault: false }
      : { key: d.key, name: d.name, subject: d.subject, bodyHtml: d.bodyHtml, bodyText: d.bodyText, isActive: true, isDefault: true };
  });
  // Include any custom templates not in defaults.
  for (const r of rows) {
    if (!DEFAULT_TEMPLATES.find((d) => d.key === r.key)) merged.push({ ...r, isDefault: false });
  }
  return NextResponse.json({ templates: merged, allowedVariables: ALLOWED_VARIABLES });
}
