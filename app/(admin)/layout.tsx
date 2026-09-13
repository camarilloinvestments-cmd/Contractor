import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { AdminSidebar } from './_components/admin-sidebar';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role === 'FIELD_WORKER') redirect('/portal');

  return (
    <div className="flex h-screen overflow-hidden">
      <AdminSidebar user={session.user} />
      <main className="flex-1 overflow-y-auto bg-background">
        {children}
      </main>
    </div>
  );
}
