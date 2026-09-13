import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { UsersContent } from './_components/users-content';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') redirect('/dashboard');
  return <UsersContent currentUserId={session.user.id} />;
}
