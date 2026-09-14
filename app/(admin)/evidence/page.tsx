import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { EvidenceContent } from './_components/evidence-content';

export const dynamic = 'force-dynamic';

export default async function EvidencePage() {
  const session = await auth();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER')) {
    redirect('/dashboard');
  }
  return <EvidenceContent />;
}
