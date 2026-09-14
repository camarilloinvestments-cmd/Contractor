// Workstream W — API key management (list / create). ADMIN only.
// The plaintext key is returned ONCE on creation and never stored.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { generateApiKey } from '@/lib/api-auth';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, keyPrefix: true, scopes: true, status: true, expiresAt: true, lastUsedAt: true, lastUsedIp: true, createdAt: true, revokedAt: true },
  });
  return NextResponse.json({ keys });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  }
  const scopes: string[] = Array.isArray(body.scopes) ? body.scopes.filter((s: any) => typeof s === 'string') : [];
  let expiresAt: Date | null = null;
  if (body.expiresAt) {
    const d = new Date(body.expiresAt);
    if (!isNaN(d.getTime())) expiresAt = d;
  }
  const { fullKey, prefix, hash } = generateApiKey();
  const rec = await prisma.apiKey.create({
    data: { name: body.name, keyPrefix: prefix, keyHash: hash, scopes, expiresAt, createdById: session.user.id },
    select: { id: true, name: true, keyPrefix: true, scopes: true, status: true, expiresAt: true, createdAt: true },
  });
  const meta = requestMeta(req);
  await writeAudit({ actor: { id: session.user.id, email: session.user.email, role: session.user.role }, action: 'api_key.create', entityType: 'ApiKey', entityId: rec.id, metadata: { name: rec.name }, ...meta });
  // fullKey shown ONCE.
  return NextResponse.json({ key: rec, plaintextKey: fullKey });
}
