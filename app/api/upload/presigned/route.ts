export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { generatePresignedUploadUrl } from '@/lib/s3';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { fileName, contentType, isPublic = false } = body ?? {};
    if (!fileName || !contentType) {
      return NextResponse.json({ error: 'Missing fileName or contentType' }, { status: 400 });
    }
    const result = await generatePresignedUploadUrl(fileName, contentType, isPublic);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Presigned URL error:', err);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
