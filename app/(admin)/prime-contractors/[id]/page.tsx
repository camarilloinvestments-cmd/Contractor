import { ContractorDetail } from './_components/contractor-detail';

export default async function ContractorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContractorDetail id={id} />;
}
