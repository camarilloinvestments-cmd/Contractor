import { IntakeReviewContent } from './_components/intake-review-content';

export default async function IntakeReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IntakeReviewContent id={id} />;
}
