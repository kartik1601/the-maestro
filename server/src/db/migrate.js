import mongoose from 'mongoose';
import { Media } from '../models/media.js';
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

  if (backfilled && !quiet) {
    console.log(`[db] backfilled videoId on ${backfilled} work${backfilled === 1 ? '' : 's'}`);
  }
  if (reindexed && !quiet) {
    console.log('[db] replaced the sparse media key index with a partial one');
  }
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
