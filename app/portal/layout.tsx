import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { PortalHeader } from './_components/portal-header';
import { getCompanyProfile } from '@/lib/branding';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.forcePasswordChange) redirect('/change-password');
  if (session.user.mfaEnrollmentRequired) redirect('/mfa/enroll');

  const branding = await getCompanyProfile();

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader user={session.user} companyName={branding.companyName} />
      <main className="pb-20">
        {children}
      </main>
    </div>
  );
}
