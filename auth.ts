import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

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
        return token;
      }
      // Subsequent requests: re-validate against the DB so deactivation and
      // session revocation (token-version bump) take effect immediately.
      if (token?.id) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { status: true, role: true, tokenVersion: true, forcePasswordChange: true },
          });
          if (!dbUser || dbUser.status !== 'ACTIVE') return null;
          if ((dbUser.tokenVersion ?? 0) !== (token.tokenVersion ?? 0)) return null;
          token.role = dbUser.role;
          token.forcePasswordChange = dbUser.forcePasswordChange;
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
        session.user.forcePasswordChange = Boolean(token.forcePasswordChange);
      }
      return session;
    },
  },
});
