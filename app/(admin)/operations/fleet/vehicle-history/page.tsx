import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { auth } from '@/auth';
import { VehicleHistoryClient } from './_components/vehicle-history-client';

export const dynamic = 'force-dynamic';

export default async function VehicleHistoryPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER') redirect('/dashboard');
  return (
    <Suspense fallback={null}>
      <VehicleHistoryClient />
    </Suspense>
  );
}
