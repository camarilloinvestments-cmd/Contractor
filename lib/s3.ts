import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client, getBucketConfig } from "./aws-config";

function shouldServeInline(contentType: string): boolean {
  return (contentType.startsWith('image/') && contentType !== 'image/svg+xml')
    || contentType.startsWith('video/')
    || contentType.startsWith('audio/');
}

export async function generatePresignedUploadUrl(
  fileName: string,
  contentType: string,
  isPublic: boolean = false
): Promise<{ uploadUrl: string; cloud_storage_path: string }> {
  const s3 = createS3Client();
  const { bucketName, folderPrefix } = getBucketConfig();
  const prefix = isPublic ? `${folderPrefix}public/uploads` : `${folderPrefix}uploads`;
  const cloud_storage_path = `${prefix}/${Date.now()}-${fileName}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
  return { uploadUrl, cloud_storage_path };
}

export async function initiateMultipartUpload(
  fileName: string,
  contentType: string,
  isPublic: boolean = false
): Promise<{ uploadId: string; cloud_storage_path: string }> {
  const s3 = createS3Client();
  const { bucketName, folderPrefix } = getBucketConfig();
  const prefix = isPublic ? `${folderPrefix}public/uploads` : `${folderPrefix}uploads`;
  const cloud_storage_path = `${prefix}/${Date.now()}-${fileName}`;

  const command = new CreateMultipartUploadCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    ContentType: contentType,
  });

  const result = await s3.send(command);
  return { uploadId: result.UploadId ?? '', cloud_storage_path };
}

export async function getPresignedUrlForPart(
  cloud_storage_path: string,
  uploadId: string,
  partNumber: number
): Promise<string> {
  const s3 = createS3Client();
  const { bucketName } = getBucketConfig();

  const command = new UploadPartCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    UploadId: uploadId,
    PartNumber: partNumber,
  });

  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

export async function completeMultipartUpload(
  cloud_storage_path: string,
  uploadId: string,
  parts: { ETag: string; PartNumber: number }[]
): Promise<void> {
  const s3 = createS3Client();
  const { bucketName } = getBucketConfig();

  const command = new CompleteMultipartUploadCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts },
  });

  await s3.send(command);
}

export async function getFileUrl(
  cloud_storage_path: string,
  contentType: string,
  isPublic: boolean = false
): Promise<string> {
  const { bucketName } = getBucketConfig();

  if (isPublic) {
    const region = process.env.AWS_REGION ?? 'us-east-1';
    const encodedPath = cloud_storage_path.split('/').map(encodeURIComponent).join('/');
    return `https://${bucketName}.s3.${region}.amazonaws.com/${encodedPath}`;
  }

  const s3 = createS3Client();
  const disposition = shouldServeInline(contentType) ? 'inline' : 'attachment';
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    ResponseContentDisposition: disposition,
  });

  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

export async function deleteFile(cloud_storage_path: string): Promise<void> {
  const s3 = createS3Client();
  const { bucketName } = getBucketConfig();

  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
  });

  await s3.send(command);
}

// ---------------------------------------------------------------------------
// Server-side direct object helpers (used by closeout generation, which builds
// files in-memory on the server and must persist them without a browser
// round-trip). These never run in client bundles.
// ---------------------------------------------------------------------------

// Upload a Buffer directly to S3 from the server and return its storage path.
// `keyPrefix` lets callers group generated artifacts (e.g. `generated/closeout`).
export async function uploadBuffer(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  keyPrefix: string = 'generated'
): Promise<{ cloud_storage_path: string }> {
  const s3 = createS3Client();
  const { bucketName, folderPrefix } = getBucketConfig();
  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
  const cloud_storage_path = `${folderPrefix}${keyPrefix}/${Date.now()}-${safeName}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: cloud_storage_path,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return { cloud_storage_path };
}

// Fetch an object's raw bytes server-side (used to bundle evidence assets into a
// closeout ZIP). Returns null on any failure so packaging can continue.
export async function getObjectBytes(
  cloud_storage_path: string
): Promise<Buffer | null> {
  try {
    const s3 = createS3Client();
    const { bucketName } = getBucketConfig();
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucketName, Key: cloud_storage_path })
    );
    const bytes = await res.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}
