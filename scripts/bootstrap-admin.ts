/**
 * bootstrap-admin.ts — create (or ensure) the FIRST administrator account.
 *
 * Security properties:
 *  - No hardcoded credentials. Email/password come from env, or a strong random
 *    password is generated and printed ONCE.
 *  - Idempotent: if an ADMIN already exists, it does nothing (never overwrites).
 *  - Intended to be run by an operator on first install, not automatically.
 *
 * Usage:
 *   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='...' \
 *     tsx --require dotenv/config scripts/bootstrap-admin.ts
 *   (omit ADMIN_PASSWORD to have a strong one generated and printed once)
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

function generatePassword(): string {
  // 24 url-safe chars (~144 bits). Printed once; never stored in plaintext.
  return crypto.randomBytes(18).toString('base64url');
}

async function main() {
  // If any ACTIVE admin already exists, do nothing (idempotent, non-destructive).
  const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (existingAdmin) {
    console.log(`An administrator already exists (${existingAdmin.email}). Nothing to do.`);
    return;
  }

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) {
    console.error('ADMIN_EMAIL is required to bootstrap the first administrator.');
    console.error("Example: ADMIN_EMAIL=you@company.com tsx --require dotenv/config scripts/bootstrap-admin.ts");
    process.exit(1);
  }

  const envPassword = process.env.ADMIN_PASSWORD;
  let password = envPassword && envPassword.length >= 12 ? envPassword : '';
  let generated = false;
  if (!password) {
    if (envPassword && envPassword.length < 12) {
      console.error('ADMIN_PASSWORD must be at least 12 characters. Aborting.');
      process.exit(1);
    }
    password = generatePassword();
    generated = true;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {}, // never overwrite an existing user
    create: {
      email,
      name: process.env.ADMIN_NAME?.trim() || 'Administrator',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  console.log(`\nAdministrator ready: ${admin.email}`);
  if (generated) {
    console.log('===== GENERATED ADMIN PASSWORD (shown once) =====');
    console.log(`  ${password}`);
    console.log('Store it now in a password manager, then sign in and change it.');
    console.log('=================================================\n');
  } else {
    console.log('Using the ADMIN_PASSWORD you supplied. Sign in and rotate it if needed.\n');
  }
}

main()
  .catch((e) => {
    console.error('bootstrap-admin failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
