import mongoose from 'mongoose';

/**
 * Images pasted or uploaded into any editor — post, poem, song, or the about page.
 *
 * Kept in its own collection rather than inlined as a data: URI, so a document stays
 * small enough to read and edit cheaply no matter how many pictures it carries. The
 * editor stores only a relative `/api/media/:id` reference in the HTML.
 */
const mediaSchema = new mongoose.Schema(
  {
    /**
     * What was uploaded. Images may live in either place; audio is R2 only, because a
     * recording is too big for a BSON document and needs the byte ranges the bucket
     * serves. Recorded so a later sweep can tell the two apart without parsing MIME.
     */
    kind: { type: String, enum: ['image', 'audio'], default: 'image', index: true },

    /**
     * Where the bytes live. Prose images go to R2 when it is configured; the author's
     * portrait deliberately stays in MongoDB, so the About page keeps working even if
     * the bucket is unreachable.
     */
    storage: { type: String, enum: ['mongo', 'r2'], default: 'mongo' },
    objectKey: { type: String, default: null },

    data: { type: Buffer, default: null },
    contentType: { type: String, required: true },
    byteSize: { type: Number, required: true },
    originalName: { type: String, default: null },
    alt: { type: String, default: '' },

    /**
     * Marks a singleton image — currently only the author's portrait.
     *
     * Keyed uploads replace the bytes of the existing document instead of inserting
     * a new one, so a picture that is swapped a dozen times still costs one document
     * rather than a dozen orphans. Unkeyed images (anything dropped into prose) have
     * no key and accumulate normally, because each one is genuinely referenced by
     * the writing that contains it.
     *
     * Uniqueness is enforced by the partial index declared below, not here.
     */
    key: { type: String, default: null },

    /**
     * Bumped on every replacement. The stored URL carries it as a query parameter,
     * which is what lets the document id stay stable while still busting caches —
     * these responses are served as immutable.
     */
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
);

/**
 * One document per key — but only for documents that actually have one.
 *
 * This must be a *partial* index rather than a sparse one. `sparse` skips documents
 * where the field is absent, and `default: null` means it never is: every unkeyed
 * upload writes `key: null` explicitly, so the first one claimed the unique slot and
 * every one after it failed with E11000. That is exactly what happened the first time
 * a second unkeyed file was uploaded.
 *
 * Filtering on `$type: 'string'` ignores the nulls no matter how they got there, so
 * the existing rows did not need rewriting. Named explicitly because the index it
 * replaces is called `key_1` — a same-named index with different options is a
 * conflict, not an upgrade. See `db/migrate.js`, which drops the old one.
 */
mediaSchema.index(
  { key: 1 },
  { unique: true, partialFilterExpression: { key: { $type: 'string' } }, name: 'media_key_unique' },
);

export const Media = mongoose.model('Media', mediaSchema);
