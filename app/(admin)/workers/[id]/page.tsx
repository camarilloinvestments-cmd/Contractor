import { WorkerDetail } from './_components/worker-detail';

export default async function WorkerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkerDetail id={id} />;
}
