// Increment 10 — Workstream P: mobile device sessions & session revocation.
// Mobile clients authenticate with a device-bound bearer token. Only the
// SHA-256 hash of the token is stored; the plaintext is returned to the device
// once at login. The server remains authoritative for all business rules.
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export const MOBILE_SESSION_TTL_DAYS = 30;
export const MOBILE_TOKEN_PREFIX = 'os1_mob_';

export interface MobileContext {
  sessionId: string;
  deviceId: string;
  deviceUuid: string;
  workerId: string | null;
  userId: string | null;
  role: string;
  email: string;
  name: string;
}

export function hashMobileToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

// Returns { token, hash }. The token is shown to the device exactly once.
export function generateMobileToken(): { token: string; hash: string } {
  const random = crypto.randomBytes(32).toString('base64url');
  const token = `${MOBILE_TOKEN_PREFIX}${random}`;
  return { token, hash: hashMobileToken(token) };
}

export function extractBearer(req: Request): string | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization');
  if (h && h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  const alt = req.headers.get('x-mobile-token');
  return alt ? alt.trim() : null;
}

export function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip');
}

// Verify the mobile session on a request. On success bumps lastUsed/lastSeen.
export async function verifyMobileSession(
  req: Request
): Promise<{ ok: true; ctx: MobileContext } | { ok: false; status: number; error: string }> {
  const token = extractBearer(req);
  if (!token) return { ok: false, status: 401, error: 'Missing session token (Authorization: Bearer <token>).' };
  const session = await prisma.mobileSession.findUnique({
    where: { tokenHash: hashMobileToken(token) },
    include: { device: true, user: true },
  });
  if (!session || session.revokedAt) return { ok: false, status: 401, error: 'Invalid or revoked session.' };
  if (session.expiresAt.getTime() < Date.now()) return { ok: false, status: 401, error: 'Session expired.' };
  if (!session.device || session.device.status !== 'ACTIVE') return { ok: false, status: 401, error: 'Device revoked.' };

  const now = new Date();
  await prisma.mobileSession.update({ where: { id: session.id }, data: { lastUsedAt: now } });
  await prisma.mobileDevice.update({
    where: { id: session.deviceId },
    data: { lastSeenAt: now, lastIp: clientIp(req) },
  });

  return {
    ok: true,
    ctx: {
      sessionId: session.id,
      deviceId: session.deviceId,
      deviceUuid: session.device.deviceUuid,
      workerId: session.workerId,
      userId: session.userId,
      role: session.user?.role ?? 'FIELD_WORKER',
      email: session.user?.email ?? '',
      name: session.user?.name ?? '',
    },
  };
}

// Register (or update) a device for a user/worker and issue a fresh session.
// Any prior active sessions for the same device are revoked (single active
// session per device).
export async function registerDeviceAndIssueSession(params: {
  deviceUuid: string;
  userId: string;
  workerId: string | null;
  platform?: 'IOS' | 'ANDROID' | 'WEB';
  deviceName?: string | null;
  deviceModel?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
  pushToken?: string | null;
  mfaVerified?: boolean;
  ip?: string | null;
}): Promise<{ token: string; deviceId: string; sessionId: string; expiresAt: Date }> {
  const now = new Date();
  const device = await prisma.mobileDevice.upsert({
    where: { deviceUuid: params.deviceUuid },
    create: {
      deviceUuid: params.deviceUuid,
      userId: params.userId,
      workerId: params.workerId,
      platform: params.platform ?? 'ANDROID',
      deviceName: params.deviceName ?? null,
      deviceModel: params.deviceModel ?? null,
      osVersion: params.osVersion ?? null,
      appVersion: params.appVersion ?? null,
      pushToken: params.pushToken ?? null,
      status: 'ACTIVE',
      lastSeenAt: now,
      lastIp: params.ip ?? null,
    },
    update: {
      userId: params.userId,
      workerId: params.workerId,
      platform: params.platform ?? 'ANDROID',
      deviceName: params.deviceName ?? undefined,
      deviceModel: params.deviceModel ?? undefined,
      osVersion: params.osVersion ?? undefined,
      appVersion: params.appVersion ?? undefined,
      pushToken: params.pushToken ?? undefined,
      // Re-registering a revoked device reactivates it for the authenticated user.
      status: 'ACTIVE',
      revokedAt: null,
      revokedById: null,
      lastSeenAt: now,
      lastIp: params.ip ?? undefined,
    },
  });

  // Revoke any lingering active sessions on this device before issuing a new one.
  await prisma.mobileSession.updateMany({
    where: { deviceId: device.id, revokedAt: null },
    data: { revokedAt: now },
  });

  const { token, hash } = generateMobileToken();
  const expiresAt = new Date(now.getTime() + MOBILE_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const session = await prisma.mobileSession.create({
    data: {
      tokenHash: hash,
      deviceId: device.id,
      workerId: params.workerId,
      userId: params.userId,
      mfaVerified: params.mfaVerified ?? false,
      expiresAt,
    },
  });

  return { token, deviceId: device.id, sessionId: session.id, expiresAt };
}

// Revoke a single session (logout).
export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.mobileSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Revoke a device and all of its sessions (admin device management).
export async function revokeDevice(deviceId: string, revokedById: string | null): Promise<void> {
  const now = new Date();
  await prisma.mobileDevice.update({
    where: { id: deviceId },
    data: { status: 'REVOKED', revokedAt: now, revokedById },
  });
  await prisma.mobileSession.updateMany({
    where: { deviceId, revokedAt: null },
    data: { revokedAt: now },
  });
}
