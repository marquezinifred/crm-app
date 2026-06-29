import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/env';

/**
 * Wrapper S3/R2 — Sprint 12.
 *
 * Função `uploadObject` armazena bytes e retorna a key.
 * Função `presignDownload` retorna URL temporária válida por `expiresInSeconds`.
 *
 * Sem credenciais (S3_ENDPOINT/S3_BUCKET ausentes) retorna `null` —
 * o caller cai para inline:base64 (compatibilidade Sprint 11).
 */

let _client: S3Client | null = null;
function client(): S3Client | null {
  if (_client) return _client;
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    return null;
  }
  _client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  return _client;
}

export function s3Enabled(): boolean {
  return client() !== null;
}

export async function uploadObject(
  key: string,
  body: Buffer | string,
  contentType: string,
): Promise<string | null> {
  const c = client();
  if (!c || !env.S3_BUCKET) return null;
  await c.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}

export async function presignDownload(
  key: string,
  expiresInSeconds = 24 * 60 * 60,
): Promise<string | null> {
  const c = client();
  if (!c || !env.S3_BUCKET) return null;
  return getSignedUrl(
    c,
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}
