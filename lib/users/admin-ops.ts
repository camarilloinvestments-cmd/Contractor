// Workstream D: shared helpers for admin-driven user lifecycle operations.
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

export type SessionActor = {
  id: string;
  email?: string | null;
  role?: string | null;
};

// Generate a strong, human-transcribable temporary password (no ambiguous chars).
export function generateTempPassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  // Guarantee at least one digit and one symbol for policy friendliness.
  return out.slice(0, length - 2) + (bytes[0] % 10) + '!';
}

// Count ACTIVE admins, optionally excluding one user id. Used to protect the
// last remaining administrator from being deactivated/deleted/demoted.
export async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
  return prisma.user.count({
    where: { role: 'ADMIN', status: 'ACTIVE', id: { not: excludeUserId } },
  });
}
