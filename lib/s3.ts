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
