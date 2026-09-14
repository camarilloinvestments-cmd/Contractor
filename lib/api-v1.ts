// Workstream W — shared guard for /api/v1 endpoints.
// Applies: authentication (API key), authorization (scope), rate limiting,
// request id. Financial writes additionally use idempotency (see withIdempotency).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyApiKey, rateLimit, newRequestId, type ApiKeyContext } from '@/lib/api-auth';

export async function guard(
  req: Request,
  scope: string
): Promise<{ ok: true; ctx: ApiKeyContext; requestId: string } | { res: NextResponse }> {
  const requestId = newRequestId();
  const v = await verifyApiKey(req, scope);
  if (!v.ok) {
    return { res: NextResponse.json({ error: v.error, requestId }, { status: v.status, headers: { 'x-request-id': requestId } }) };
  }
  const rl = rateLimit(v.ctx.id);
  if (!rl.ok) {
    return { res: NextResponse.json({ error: 'Rate limit exceeded', requestId }, { status: 429, headers: { 'x-request-id': requestId } }) };
  }
  return { ok: true, ctx: v.ctx, requestId };
}

export function ok(data: any, requestId: string, status = 200): NextResponse {
  return NextResponse.json({ data, requestId }, { status, headers: { 'x-request-id': requestId } });
}

// Idempotency for financial writes: replays the stored response for a repeated
// Idempotency-Key, otherwise runs `fn` and records the result.
export async function withIdempotency(
  req: Request,
  requestId: string,
  fn: () => Promise<{ status: number; body: any }>
): Promise<NextResponse> {
  const key = req.headers.get('idempotency-key');
  if (key) {
    const prior = await prisma.apiIdempotencyKey.findUnique({ where: { key } });
    if (prior && prior.responseBody) {
      return NextResponse.json(prior.responseBody as any, { status: prior.statusCode || 200, headers: { 'x-request-id': requestId, 'idempotency-replayed': 'true' } });
    }
  }
  const result = await fn();
  const bodyWithReq = { ...result.body, requestId };
  if (key) {
    await prisma.apiIdempotencyKey.upsert({
      where: { key },
      create: { key, method: req.method, path: new URL(req.url).pathname, statusCode: result.status, responseBody: bodyWithReq as any },
      update: {},
    });
  }
  return NextResponse.json(bodyWithReq, { status: result.status, headers: { 'x-request-id': requestId } });
}
