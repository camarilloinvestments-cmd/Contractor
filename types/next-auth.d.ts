import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      workerId: string | null;
    };
  }

  interface User {
    role: string;
    workerId: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: string;
    workerId: string | null;
  }
}
