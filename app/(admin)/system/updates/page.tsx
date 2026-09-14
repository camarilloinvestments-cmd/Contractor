import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { UpdatesClient } from './_components/updates-client';

export const dynamic = 'force-dynamic';

export default async function SystemUpdatesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN') redirect('/dashboard');
  return <UpdatesClient />;
}
