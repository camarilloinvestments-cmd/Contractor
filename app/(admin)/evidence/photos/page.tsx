import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { FieldPhotoReview } from './_components/field-photo-review';

export const dynamic = 'force-dynamic';

export default async function FieldPhotosPage() {
  const session = await auth();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER')) {
    redirect('/dashboard');
  }
  return <FieldPhotoReview isAdmin={session.user.role === 'ADMIN'} />;
}
