import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import {
  isMfaRequiredForRole,
  verifyTotp,
  decryptTotpSecret,
  consumeRecoveryCode,
} from '@/lib/mfa';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp: { label: 'Authenticator code', type: 'text' },
        recoveryCode: { label: 'Recovery code', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: { worker: true },
        });
        if (!user) return null;
        // Workstream D: block non-active accounts at the door.
        if (user.status !== 'ACTIVE') return null;
        const isValid = await bcrypt.compare(credentials.password as string, user.passwordHash);
        if (!isValid) return null;

        // Workstream E: MFA gate. Enforced only when MFA is already enrolled.
        // If MFA is required by policy but NOT yet enrolled, we allow the login
        // and gate the session to the mandatory-enrollment flow (see jwt/session).
        if (user.mfaEnabled && user.mfaSecret) {
          const totp = (credentials.totp as string | undefined)?.trim();
          const recoveryCode = (credentials.recoveryCode as string | undefined)?.trim();
          let mfaOk = false;
          if (totp) {
            try {
              mfaOk = verifyTotp(totp, decryptTotpSecret(user.mfaSecret));
            } catch {
              mfaOk = false;
            }
          } else if (recoveryCode) {
            mfaOk = await consumeRecoveryCode(user.id, recoveryCode);
          }
          if (!mfaOk) return null;
          // Best-effort stamp of last successful MFA verification.
          try {
            await prisma.user.update({
              where: { id: user.id },
              data: { mfaLastVerifiedAt: new Date() },
            });
          } catch {}
        }

        // Best-effort last-login stamp; never block login on failure.
        try {
          await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        } catch {}
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          workerId: user.workerId,
          tokenVersion: user.tokenVersion,
          forcePasswordChange: user.forcePasswordChange,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.workerId = user.workerId;
        token.tokenVersion = user.tokenVersion ?? 0;
        token.forcePasswordChange = user.forcePasswordChange ?? false;
      }
      // Re-validate against the DB each request so deactivation, session
      // revocation (token-version bump) and MFA enrollment state take effect
      // immediately.
      if (token?.id) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: {
              status: true,
              role: true,
              tokenVersion: true,
              forcePasswordChange: true,
              mfaEnabled: true,
            },
          });
          if (!dbUser || dbUser.status !== 'ACTIVE') return null;
          if ((dbUser.tokenVersion ?? 0) !== (token.tokenVersion ?? 0)) return null;
          token.role = dbUser.role;
          token.forcePasswordChange = dbUser.forcePasswordChange;
          const mfaRequired = await isMfaRequiredForRole(dbUser.role);
          token.mfaEnrollmentRequired = mfaRequired && !dbUser.mfaEnabled;
        } catch {
          // On a transient DB error, keep the existing token rather than logging
          // everyone out; the next request will re-validate.
        }
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session?.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.workerId = token.workerId as string | null;
        session.user.mfaEnrollmentRequired = token.mfaEnrollmentRequired as boolean;
        session.user.forcePasswordChange = Boolean(token.forcePasswordChange);
      }
      return session;
    },
  },
});
