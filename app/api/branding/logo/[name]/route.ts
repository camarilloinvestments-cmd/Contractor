export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { readLocalLogo } from '@/lib/branding-storage';

// Public serving of locally-stored company logos (used only in local-storage
// fallback mode; S3 mode serves directly from the bucket URL). The logo is a
// non-sensitive brand asset shown on the login page, app header, emails, and
// PDFs, so this endpoint is intentionally unauthenticated. Path traversal is
// structurally prevented by safeLocalFilename() inside readLocalLogo().
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const logo = await readLocalLogo(name);
  if (!logo) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(logo.buffer), {
    status: 200,
    headers: {
      'Content-Type': logo.contentType,
      'Cache-Control': 'public, max-age=300, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
