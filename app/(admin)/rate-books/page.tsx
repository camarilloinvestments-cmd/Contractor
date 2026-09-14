import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { RateBooksContent } from './_components/rate-books-content';

export const dynamic = 'force-dynamic';

export default async function RateBooksPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = session.user.role;
  if (role !== 'ADMIN' && role !== 'PROJECT_MANAGER') redirect('/dashboard');
  return <RateBooksContent />;
}
