import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SettingsContent } from './_components/settings-content';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN') redirect('/dashboard');
  return <SettingsContent />;
}
