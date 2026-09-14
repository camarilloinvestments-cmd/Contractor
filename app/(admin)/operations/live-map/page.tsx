import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { LiveMapClient } from './_components/live-map-client';

export const dynamic = 'force-dynamic';

export default async function LiveMapPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER') redirect('/dashboard');
  return <LiveMapClient />;
}
