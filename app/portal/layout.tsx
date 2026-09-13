import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { PortalHeader } from './_components/portal-header';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader user={session.user} />
      <main className="pb-20">
        {children}
      </main>
    </div>
  );
}
