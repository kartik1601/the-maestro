import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';

/**
 * The film that plays after the letter's names, kept in GridFS.
 *
 * Not in the bucket: R2 here serves the public writing, and this must never have a
 * public URL. Not in a plain document either — a minute of video is past BSON's 16 MB.
 * GridFS chunks it, and can read any byte range back out, which a <video> seeking
 * around needs.
 */
const BUCKET = 'letterVideo';

/** Two cuts: 1080p for a desktop, 720p for a phone on mobile data. */
export const VIDEO_FILES = { hd: 'letter-1080.mp4', sd: 'letter-720.mp4' };

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET });
const files = () => mongoose.connection.db.collection(`${BUCKET}.files`);

export async function findVideo(quality) {
  const filename = VIDEO_FILES[quality];
  if (!filename) return null;
  return files().find({ filename }).sort({ uploadDate: -1 }).limit(1).next();
}

export async function hasVideo() {
  return (await files().countDocuments({ filename: { $in: Object.values(VIDEO_FILES) } })) > 0;
}

/** Bytes [start, end] inclusive, as a Range header counts them. */
export function openVideo(file, start, end) {
  return bucket().openDownloadStream(file._id, { start, end: end + 1 });
}

/** Uploads a cut, then removes the copies it replaces — never the other way round. */
export async function storeVideo(quality, path) {
  const filename = VIDEO_FILES[quality];
  if (!filename) throw new Error(`Unknown quality: ${quality}`);
  const upload = bucket().openUploadStream(filename, { metadata: { contentType: 'video/mp4' } });
  await pipeline(createReadStream(path), upload);
  const older = await files().find({ filename, _id: { $ne: upload.id } }).toArray();
  for (const file of older) await bucket().delete(file._id);
  return { id: String(upload.id), length: upload.length ?? null, replaced: older.length };
}
