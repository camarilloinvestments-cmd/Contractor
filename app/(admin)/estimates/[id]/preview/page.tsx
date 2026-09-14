'use client';

import { useParams } from 'next/navigation';
import { CommercialDocPreview } from '@/components/commercial-doc-preview';

export default function EstimatePreviewPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  return <CommercialDocPreview kind="estimate" id={id} />;
}
