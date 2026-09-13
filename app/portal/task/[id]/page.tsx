import { PortalTaskDetail } from './_components/portal-task-detail';

export default async function PortalTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PortalTaskDetail id={id} />;
}
