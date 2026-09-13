import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getCompanyProfile } from '@/lib/branding';
import { PRODUCT_NAME } from '@/lib/version';
import { ChangePasswordForm } from './_components/change-password-form';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const branding = await getCompanyProfile();
  const forced = Boolean(session.user.forcePasswordChange);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-display font-bold tracking-tight">{branding.companyName || PRODUCT_NAME}</h1>
          <p className="text-muted-foreground mt-1">
            {forced ? 'You must change your password before continuing.' : 'Update your account password.'}
          </p>
        </div>
        <ChangePasswordForm forced={forced} role={session.user.role} />
      </div>
    </div>
  );
}
