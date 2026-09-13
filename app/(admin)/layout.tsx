import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { AdminSidebar } from './_components/admin-sidebar';
import { getCompanyProfile } from '@/lib/branding';
import { APP_VERSION, PRODUCT_NAME } from '@/lib/version';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role === 'FIELD_WORKER') redirect('/portal');

  const branding = await getCompanyProfile();

  return (
    <div className="flex h-screen overflow-hidden">
      <AdminSidebar user={session.user} companyName={branding.companyName} productName={PRODUCT_NAME} appVersion={APP_VERSION} />
      <main className="flex-1 overflow-y-auto bg-background">
        {children}
      </main>
    </div>
  );
}
