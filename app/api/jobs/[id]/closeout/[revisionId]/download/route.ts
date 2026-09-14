export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getFileUrl } from '@/lib/s3';

// GET: return a presigned download URL for a closeout artifact.
// Query: ?file=zip|workbook|kmz|summary  (default zip)
export async function GET(request: Request, { params }: { params: Promise<{ id: string; revisionId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, revisionId } = await params;

  const rev = await prisma.closeoutRevision.findUnique({ where: { id: revisionId } });
  if (!rev || rev.jobId !== id) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const file = searchParams.get('file') ?? 'zip';
  const pathMap: Record<string, string | null> = {
    zip: rev.zipPath,
    workbook: rev.workbookPath,
    kmz: rev.kmzPath,
    summary: rev.summaryPdfPath,
  };
  const cloudPath = pathMap[file];
  if (!cloudPath) return NextResponse.json({ error: 'Artifact not available' }, { status: 404 });

  const contentTypeMap: Record<string, string> = {
    zip: 'application/zip',
    workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kmz: 'application/vnd.google-earth.kmz',
    summary: 'application/pdf',
  };
  const url = await getFileUrl(cloudPath, contentTypeMap[file] ?? 'application/octet-stream', false);
  return NextResponse.json({ url });
}
