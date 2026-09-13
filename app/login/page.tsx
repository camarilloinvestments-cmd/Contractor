import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { LoginForm } from './_components/login-form';

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) {
    if (session.user.role === 'FIELD_WORKER') redirect('/portal');
    else redirect('/dashboard');
  }
  return <LoginForm />;
}
