export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getPriceBook } from '@/lib/price-books';
import { generateExportXlsx } from '@/lib/price-import';

// Client-safe export: contains only the prime billing rates (what the prime
// pays us). No subcontractor payouts, in-house costs, commissions, or margin.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const book = await getPriceBook(id);
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const buf = await generateExportXlsx(
    { name: book.name, primeName: book.primeContractor?.companyName ?? '', version: book.version, effectiveDate: book.effectiveDate },
    book.lines.map((l) => ({ jobCode: l.jobCode, description: l.description, unit: l.unit, ratePerUnit: l.ratePerUnit, category: l.category, notes: l.notes })),
  );
  const safeName = (book.name || 'price-book').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${safeName}-v${book.version}.xlsx"`,
    },
  });
}
