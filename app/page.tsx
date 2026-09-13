import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function HomePage() {
  const session = await auth();
  if (session?.user) {
    const role = session.user.role;
    if (role === 'FIELD_WORKER') {
      redirect('/portal');
    } else {
      redirect('/dashboard');
    }
  }
  redirect('/login');
}
