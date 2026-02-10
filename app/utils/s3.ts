import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3AccessKeyId, s3AccountId, s3Bucket, s3PublicUrl, s3Region, s3SecretAccessKey } from '@/config'

let client: S3Client | null = null

export function isS3Enabled(): boolean {
  return !!(s3AccountId && s3Bucket && s3AccessKeyId && s3SecretAccessKey)
}

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: s3Region,
      endpoint: `https://${s3AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
      },
    })
  }
  return client
}

export async function uploadToS3(key: string, body: ArrayBuffer, contentType: string): Promise<void> {
  await getClient().send(new PutObjectCommand({
    Bucket: s3Bucket,
    Key: key,
    Body: new Uint8Array(body),
    ContentType: contentType,
  }))
}

export async function getPresignedUploadUrl(key: string, contentType: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(getClient(), new PutObjectCommand({
    Bucket: s3Bucket,
    Key: key,
    ContentType: contentType,
  }), { expiresIn })
}

export async function getDownloadUrl(key: string): Promise<string> {
  if (s3PublicUrl) {
    const base = s3PublicUrl.replace(/\/+$/, '')
    return `${base}/${key}`
  }
  return getSignedUrl(getClient(), new GetObjectCommand({
    Bucket: s3Bucket,
    Key: key,
  }), { expiresIn: 3600 })
}

export async function deleteFromS3(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({
    Bucket: s3Bucket,
    Key: key,
  }))
}

export async function headS3Object(key: string): Promise<{ size: number, contentType: string } | null> {
  try {
    const res = await getClient().send(new HeadObjectCommand({
      Bucket: s3Bucket,
      Key: key,
    }))
    return {
      size: res.ContentLength ?? 0,
      contentType: res.ContentType ?? 'application/octet-stream',
    }
  }
  catch {
    return null
  }
}
