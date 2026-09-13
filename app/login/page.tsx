import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { LoginForm } from './_components/login-form';
import { getCompanyProfile } from '@/lib/branding';

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) {
    if (session.user.role === 'FIELD_WORKER') redirect('/portal');
    else redirect('/dashboard');
  }
  const branding = await getCompanyProfile();
  return <LoginForm companyName={branding.companyName} />;
}
