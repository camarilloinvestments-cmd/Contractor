// Workstream W — API key generation + verification for /api/v1 (v1.2.0).
// The plaintext key is shown ONCE at creation; only its SHA-256 hash is stored.
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export interface ApiKeyContext {
  id: string;
  name: string;
  scopes: string[];
}

export function hashKey(fullKey: string): string {
  return crypto.createHash('sha256').update(fullKey, 'utf8').digest('hex');
}

// Returns { fullKey, prefix, hash }. Format: os1_sk_<random>
export function generateApiKey(): { fullKey: string; prefix: string; hash: string } {
  const random = crypto.randomBytes(24).toString('base64url');
  const fullKey = `os1_sk_${random}`;
  const prefix = fullKey.slice(0, 12); // os1_sk_ + first chars
  return { fullKey, prefix, hash: hashKey(fullKey) };
}

function extractBearer(req: Request): string | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization');
  if (h && h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  const alt = req.headers.get('x-api-key');
  return alt ? alt.trim() : null;
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip');
}

// Verify the API key on a request. On success updates lastUsedAt/lastUsedIp.
// If `scope` is provided, the key must carry it (or the wildcard '*').
export async function verifyApiKey(
  req: Request,
  scope?: string
): Promise<{ ok: true; ctx: ApiKeyContext } | { ok: false; status: number; error: string }> {
  const key = extractBearer(req);
  if (!key) return { ok: false, status: 401, error: 'Missing API key (Authorization: Bearer <key>).' };
  const rec = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(key) } });
  if (!rec || rec.status !== 'ACTIVE') return { ok: false, status: 401, error: 'Invalid or revoked API key.' };
  if (rec.expiresAt && rec.expiresAt.getTime() < Date.now()) {
    return { ok: false, status: 401, error: 'API key expired.' };
  }
  if (scope && !rec.scopes.includes(scope) && !rec.scopes.includes('*')) {
    return { ok: false, status: 403, error: `API key missing required scope: ${scope}` };
  }
  await prisma.apiKey.update({
    where: { id: rec.id },
    data: { lastUsedAt: new Date(), lastUsedIp: clientIp(req) },
  });
  return { ok: true, ctx: { id: rec.id, name: rec.name, scopes: rec.scopes } };
}

// Simple in-memory rate limiter (per key + minute window). Best-effort; a
// distributed limiter would back this in a multi-instance deployment.
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(keyId: string, limitPerMin = 120): { ok: boolean; remaining: number } {
  const now = Date.now();
  const b = buckets.get(keyId);
  if (!b || b.resetAt < now) {
    buckets.set(keyId, { count: 1, resetAt: now + 60000 });
    return { ok: true, remaining: limitPerMin - 1 };
  }
  b.count += 1;
  return { ok: b.count <= limitPerMin, remaining: Math.max(0, limitPerMin - b.count) };
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
