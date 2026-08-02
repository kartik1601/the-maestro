import crypto from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';

/**
 * Object storage for the heavy things — uploaded PDFs and images pasted into prose.
 *
 * Cloudflare R2 speaks the S3 API, so the AWS SDK talks to it unchanged. Two reasons
 * this exists rather than keeping everything in MongoDB:
 *
 *   - a single BSON document is capped at 16 MB, which is a hard wall a long novel
 *     will eventually hit
 *   - R2 serves byte ranges, so a reader sees page one while the rest arrives
 *
 * When R2 is not configured the store reports itself unavailable and callers fall
 * back to storing bytes in Mongo, so a clone with no credentials still runs.
 */

let client = null;

export const isConfigured = () =>
  Boolean(env.r2.accountId && env.r2.accessKeyId && env.r2.secretAccessKey && env.r2.bucket);

function s3() {
  if (client) return client;

  client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.r2.accessKeyId,
      secretAccessKey: env.r2.secretAccessKey,
    },
  });

  return client;
}

/**
 * Keys are prefixed by kind and carry a random suffix, so replacing a file never
 * collides with a cached copy of the previous one and nothing is guessable.
 */
export function buildKey(kind, name) {
  const safe = String(name ?? 'file')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-60);

  return `${kind}/${crypto.randomBytes(8).toString('hex')}-${safe || 'file'}`;
}

export async function putObject({ key, body, contentType }) {
  await s3().send(
    new PutObjectCommand({
      Bucket: env.r2.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  return key;
}

export async function deleteObject(key) {
  if (!key) return;

  try {
    await s3().send(new DeleteObjectCommand({ Bucket: env.r2.bucket, Key: key }));
  } catch (error) {
    // A file that is already gone is the state we wanted; anything else is worth
    // knowing about but must not fail the request that triggered the cleanup.
    console.warn(`[r2] could not delete ${key}: ${error?.message}`);
  }
}

/**
 * Where a reader should be sent for the bytes.
 *
 * A published object goes to the public base URL when one is configured, so the CDN
 * can cache it and range requests cost nothing. Anything else — drafts, or a bucket
 * with no public hostname — gets a short-lived signed URL instead, which keeps
 * unpublished work unreadable to anyone without a session.
 */
export async function resolveUrl(key, { public: isPublic = false } = {}) {
  if (isPublic && env.r2.publicBaseUrl) {
    return `${env.r2.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }

  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: env.r2.bucket, Key: key }), {
    expiresIn: env.r2.signedUrlTtl,
  });
}
