// General-purpose audit trail helper (Phase 1 / v1.1.0).
//
// Records privileged/config actions (branding changes, email settings, invoice
// sends, etc.). Best-effort: an audit failure must never break the primary
// operation, so writeAudit swallows and logs its own errors.
import { prisma } from '@/lib/prisma';

export type AuditActor = {
  id?: string | null;
  email?: string | null;
  role?: string | null;
};

export type AuditInput = {
  actor?: AuditActor;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actor?.id ?? null,
        actorEmail: input.actor?.email ?? null,
        actorRole: input.actor?.role ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: (input.metadata ?? undefined) as any,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write audit log:', (err as Error)?.message);
  }
}

// Convenience to pull request metadata (IP + UA) from a Request.
export function requestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const h = req.headers;
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    null;
  return { ipAddress: ip, userAgent: h.get('user-agent') };
}
