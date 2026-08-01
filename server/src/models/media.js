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
    data: { type: Buffer, required: true },
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
     * Sparse, so the many null-keyed images do not collide on the unique index.
     */
    key: { type: String, default: null, unique: true, sparse: true },

    /**
     * Bumped on every replacement. The stored URL carries it as a query parameter,
     * which is what lets the document id stay stable while still busting caches —
     * these responses are served as immutable.
     */
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
);

export const Media = mongoose.model('Media', mediaSchema);
