import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { DevicesContent } from './_components/devices-content';

export const dynamic = 'force-dynamic';

export default async function DevicesPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') redirect('/dashboard');
  return <DevicesContent />;
}
