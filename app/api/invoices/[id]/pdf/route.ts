export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import { InvoicePDF } from '@/components/invoice-pdf';
import { getCompanyProfile, getBrandingLogoBytes } from '@/lib/branding';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        primeContractor: true,
        items: true,
      },
    });
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const branding = await getCompanyProfile();
    // Resolve the logo to a data URI so it renders regardless of backend
    // (S3 public URL or local-storage fallback served via /api/branding/logo).
    // react-pdf's <Image> cannot fetch relative URLs or render SVG, so only
    // raster logos are inlined; SVG keeps the original URL.
    const logo = await getBrandingLogoBytes(branding);
    const brandingForPdf: any = { ...branding };
    if (logo && logo.ext !== 'svg') {
      brandingForPdf.logoUrl = `data:${logo.contentType};base64,${logo.buffer.toString('base64')}`;
    }
    const buffer = await renderToBuffer(
      React.createElement(InvoicePDF, { invoice: invoice as any, branding: brandingForPdf }) as any
    );

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.pdf"`,
      },
    });
  } catch (err: any) {
    console.error('PDF generation error:', err);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
