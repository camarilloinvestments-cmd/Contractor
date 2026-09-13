import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      workerId: string | null;
      forcePasswordChange?: boolean;
    };
  }

  interface User {
    role: string;
    workerId: string | null;
    tokenVersion?: number;
    forcePasswordChange?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: string;
    workerId: string | null;
    tokenVersion?: number;
    forcePasswordChange?: boolean;
  }
}
