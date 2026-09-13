import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getCompanyProfile } from '@/lib/branding';
import { PRODUCT_NAME } from '@/lib/version';
import { isMfaRequiredForRole } from '@/lib/mfa';
import { EnrollForm } from './_components/enroll-form';

export const dynamic = 'force-dynamic';

export default async function MfaEnrollPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // If already enrolled, there's nothing to do here — send the user home.
  const required = await isMfaRequiredForRole(session.user.role as any);
  const enrollmentRequired = Boolean(session.user.mfaEnrollmentRequired);

  const branding = await getCompanyProfile();
  const dest = session.user.role === 'FIELD_WORKER' ? '/portal' : '/dashboard';

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-display font-bold tracking-tight">{branding.companyName || PRODUCT_NAME}</h1>
          <p className="text-muted-foreground mt-1">
            {enrollmentRequired
              ? 'Two-factor authentication is required for your account. Set it up to continue.'
              : 'Add an extra layer of security to your account.'}
          </p>
        </div>
        <EnrollForm required={required || enrollmentRequired} dest={dest} />
      </div>
    </div>
  );
}
