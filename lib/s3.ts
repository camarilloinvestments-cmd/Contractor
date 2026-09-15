import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
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

// ---------------------------------------------------------------------------
// Dedicated field-photo evidence upload (cold-review §3).
//
// - server-generated, high-entropy object key under a dedicated evidence prefix
// - ContentType is bound into the signed PutObject so the client must send a
//   matching Content-Type header (X-Amz-SignedHeaders includes content-type)
// - a short URL TTL that expires together with the reservation
//
// NOTE: a presigned PUT cannot bind an exact Content-Length at signing time
// (the size is unknown until upload), so the authoritative size limit is
// enforced server-side via headObject() BEFORE the object is ever downloaded.
// ---------------------------------------------------------------------------
export async function generateEvidenceUploadUrl(
  contentType: string,
  ext: string,
  ttlSeconds: number,
): Promise<{ uploadUrl: string; cloud_storage_path: string }> {
  const s3 = createS3Client();
  const { bucketName, folderPrefix } = getBucketConfig();
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10); // YYYY-MM-DD
  // High-entropy key: UUID is the security/uniqueness boundary, not Date+name.
  const cloud_storage_path = `${folderPrefix}evidence/originals/${datePart}/${randomUUID()}.${ext}`;
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: ttlSeconds });
  return { uploadUrl, cloud_storage_path };
}

// HEAD an object to learn its size and content type WITHOUT downloading it.
// Used to reject oversized/wrong-type evidence before any GetObject download.
export async function headObject(
  cloud_storage_path: string
): Promise<{ exists: boolean; contentLength: number | null; contentType: string | null }> {
  try {
    const s3 = createS3Client();
    const { bucketName } = getBucketConfig();
    const res = await s3.send(
      new HeadObjectCommand({ Bucket: bucketName, Key: cloud_storage_path })
    );
    return {
      exists: true,
      contentLength: typeof res.ContentLength === 'number' ? res.ContentLength : null,
      contentType: res.ContentType ?? null,
    };
  } catch {
    return { exists: false, contentLength: null, contentType: null };
  }
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
  cloud_storage_path: string,
  maxBytes?: number,
): Promise<Buffer | null> {
  try {
    const s3 = createS3Client();
    const { bucketName } = getBucketConfig();
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucketName, Key: cloud_storage_path })
    );
    // Defense-in-depth: if the object advertises a size over the cap, refuse to
    // buffer it. Callers should HEAD first, but this guards direct callers too.
    if (maxBytes != null && typeof res.ContentLength === 'number' && res.ContentLength > maxBytes) {
      return null;
    }
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) return null;
    if (maxBytes != null && bytes.length > maxBytes) return null;
    return Buffer.from(bytes);
  } catch {
    return null;
  }
}
