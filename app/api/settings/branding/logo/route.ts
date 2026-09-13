export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { generatePresignedUploadUrl, getFileUrl } from '@/lib/s3';
import { getBucketConfig } from '@/lib/aws-config';

const ALLOWED = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml'];

// Returns a presigned PUT URL for uploading a company logo, plus the public URL
// and storage path to persist on the CompanyProfile. Logos are stored as public
// objects so the URL renders in the app, emails, and PDFs; the storage path is
// retained for server-side packaging (e.g. embedding the logo inside a KMZ).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { bucketName } = getBucketConfig();
  if (!bucketName) {
    return NextResponse.json(
      { error: 'File storage is not configured. Set AWS_BUCKET_NAME to enable logo uploads, or paste a logo URL instead.' },
      { status: 503 }
    );
  }
  try {
    const body = await req.json();
    const { fileName, contentType } = body ?? {};
    if (!fileName || !contentType) {
      return NextResponse.json({ error: 'Missing fileName or contentType' }, { status: 400 });
    }
    if (!ALLOWED.includes(String(contentType).toLowerCase())) {
      return NextResponse.json({ error: 'Unsupported image type. Use PNG, JPG, WEBP, GIF, or SVG.' }, { status: 400 });
    }
    const safeName = `logo-${String(fileName).replace(/[^A-Za-z0-9._-]/g, '_')}`;
    const { uploadUrl, cloud_storage_path } = await generatePresignedUploadUrl(safeName, contentType, true);
    const publicUrl = await getFileUrl(cloud_storage_path, contentType, true);
    return NextResponse.json({ uploadUrl, cloud_storage_path, publicUrl, contentType });
  } catch (err: any) {
    console.error('Logo presign error:', err?.message);
    return NextResponse.json({ error: 'Failed to prepare logo upload' }, { status: 500 });
  }
}
