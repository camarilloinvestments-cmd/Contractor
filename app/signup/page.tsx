import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { SignupForm } from './_components/signup-form';
import { getCompanyProfile } from '@/lib/branding';

export default async function SignupPage() {
  const session = await auth();
  if (session?.user) {
    if (session.user.role === 'FIELD_WORKER') redirect('/portal');
    else redirect('/dashboard');
  }
  const branding = await getCompanyProfile();
  return <SignupForm companyName={branding.companyName} />;
}
