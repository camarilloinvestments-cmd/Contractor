export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { generateErrorXlsx, type ErrorRow } from '@/lib/price-import';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const record = await prisma.priceImport.findUnique({ where: { id } });
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const errors = (record.errorRows as any as ErrorRow[]) || [];
  const buf = await generateErrorXlsx(errors);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="rows-requiring-correction.xlsx"',
    },
  });
}
