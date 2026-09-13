import { PortalJobDetail } from './_components/portal-job-detail';

export default async function PortalJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PortalJobDetail id={id} />;
}
