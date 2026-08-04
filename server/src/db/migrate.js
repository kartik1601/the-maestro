import mongoose from 'mongoose';
import { Media } from '../models/media.js';
import { Page } from '../models/page.js';
import { Post } from '../models/post.js';
import { Work } from '../models/work.js';

/**
 * Backfills fields that were added to a schema after data already existed.
 *
 * Runs on every boot, and is written so that a database already in the target shape
 * costs one indexed query that matches nothing. This is deliberately not part of the
 * seeder: the seeder writes the *catalogue*, and is skipped against a real database
 * for that reason. A backfill only ever derives a field from what is already there,
 * so it is safe to run against the author's own archive.
 */
export async function runMigrations({ quiet = false } = {}) {
  const backfilled = await backfillVideoIds();
  const reindexed = await replaceMediaKeyIndex();
  const rehomed = await relativizeMediaUrls();

  if (backfilled && !quiet) {
    console.log(`[db] backfilled videoId on ${backfilled} work${backfilled === 1 ? '' : 's'}`);
  }
  if (reindexed && !quiet) {
    console.log('[db] replaced the sparse media key index with a partial one');
  }
  if (rehomed && !quiet) {
    console.log(`[db] made ${rehomed} media reference${rehomed === 1 ? '' : 's'} relative`);
  }
}

/**
 * Rewrites media references that carry a host to the relative form.
 *
 * Until v1.4.0 the editor stored whatever URL the browser needed at the time, which in
 * development is `http://localhost:4000/api/media/…` — an address that exists on one
 * laptop. Content authored locally therefore looked right locally and broke on the
 * deployed site: images 404, and audio blocks were removed outright by the client's
 * own source check.
 *
 * Only the origin is dropped; the id, and everything else in the document, is left
 * exactly as the author wrote it. The same file is served either way, because both
 * environments read the same database and the same bucket.
 */
async function relativizeMediaUrls() {
  const pattern = /(\s(?:src|data-audio)=")https?:\/\/[^/"]+(\/api\/media\/[a-f\d]{24})/gi;
  let changed = 0;

  for (const model of [Work, Page, Post]) {
    const documents = await model
      .find({ body: { $regex: '(src|data-audio)="https?://[^/"]+/api/media/', $options: 'i' } })
      .select('body')
      .lean();

    for (const document of documents) {
      const body = String(document.body ?? '').replace(pattern, '$1$2');
      if (body === document.body) continue;

      // timestamps: false — removing a hostname is a repair, not an edit by the
      // author, and `updatedAt` is what the viewer sync shows a refresh pill for.
      await model.updateOne({ _id: document._id }, { $set: { body } }, { timestamps: false });
      changed += 1;
    }
  }

  return changed;
}

/**
 * v1.4.0 replaced `media.key_1` — unique and sparse — with a partial index.
 *
 * The old one was wrong from the start and only looked right because the collection
 * held a single unkeyed file: `sparse` ignores documents where the field is missing,
 * but `key` defaults to `null` and is therefore always present, so the second unkeyed
 * upload collided on `{ key: null }`. Mongoose will not alter an index that already
 * exists, so the stale one has to be dropped by hand before the new one can build.
 *
 * No document is touched — the new index simply does not consider nulls.
 */
async function replaceMediaKeyIndex() {
  const collection = mongoose.connection.db.collection('media');

  let existing;
  try {
    existing = await collection.indexes();
  } catch (error) {
    // A database that has never held media has no collection to reindex.
    if (error?.codeName === 'NamespaceNotFound') return false;
    throw error;
  }

  const stale = existing.find((index) => index.name === 'key_1' && !index.partialFilterExpression);
  if (!stale) return false;

  await collection.dropIndex('key_1');
  // Explicit rather than left to autoIndex: the drop and the build belong together,
  // and a boot that does one without the other leaves uniqueness unenforced.
  await Media.createIndexes();
  return true;
}

/**
 * v1.4.0 denormalized the first embedded video onto the work so the Songs shelf can
 * show a thumbnail without loading every body. Works written before that carry the
 * video in their markup but no `videoId`, and would otherwise stay text-only until
 * the author happened to re-save them.
 */
async function backfillVideoIds() {
  const pending = await Work.find({ videoId: { $exists: false }, kind: 'document' })
    .select('body')
    .lean();

  if (pending.length === 0) return 0;

  const writes = pending.map((work) => ({
    updateOne: {
      filter: { _id: work._id },
      // $set rather than a save(): timestamps must not move. A derived field arriving
      // late is not an edit, and `updatedAt` is what the viewer sync polls on.
      update: { $set: { videoId: String(work.body ?? '').match(/data-youtube="([\w-]{11})"/)?.[1] ?? '' } },
      timestamps: false,
    },
  }));

  await Work.bulkWrite(writes, { timestamps: false });
  return writes.length;
}
