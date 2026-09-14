export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import { QuotePDF } from '@/components/document-pdf';
import { resolveBrandingForPdf } from '@/lib/documents/pdf';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { id } = await params;
  try {
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: { primeContractor: true, project: true, salesperson: true, items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const branding = await resolveBrandingForPdf();
    const buffer = await renderToBuffer(
      React.createElement(QuotePDF, { quote: quote as any, branding }) as any
    );
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${quote.quoteNumber}.pdf"`,
      },
    });
  } catch (err: any) {
    console.error('Quote PDF error:', err?.message);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
