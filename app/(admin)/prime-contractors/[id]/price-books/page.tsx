import { PriceBooksManager } from './_components/price-books-manager';

export default async function PriceBooksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PriceBooksManager primeId={id} />;
}
