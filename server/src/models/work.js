import mongoose from 'mongoose';

export const SECTIONS = ['novels', 'poems', 'songs', 'plays', 'novelettes'];

/**
 * Two kinds of work share one collection because they share one lifecycle
 * (list, order, publish, feature) and differ only in where the body lives:
 *
 *   kind: 'document' -> Poems, Songs. Body is rich text edited in-place by the admin.
 *   kind: 'upload'   -> Novels, Plays, Novelettes. Body is an uploaded PDF.
 */
const workSchema = new mongoose.Schema(
  {
    section: { type: String, enum: SECTIONS, required: true, index: true },
    kind: { type: String, enum: ['document', 'upload'], required: true },

    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    subtitle: { type: String, default: '' },
    summary: { type: String, default: '' },

    /** Sub-grouping inside a section: 'rains-of-love' | 'others' | 'kk' | 'uranium-235'. */
    collectionKey: { type: String, default: 'others', index: true },

    /** Position within the series — 1..16 for Uranium-235. */
    seriesNumber: { type: Number, default: null },

    /**
     * The one word in the title that carries the green/red tint on the Novels shelf.
     * Chosen per book by the author rather than derived — the picks follow the
     * meaning of each title, not its grammar ("A **Red** Kingdom" but "A Heart of
     * **Flames**"), so no rule can produce them. Empty means no tint.
     */
    tintWord: { type: String, default: '' },

    /** Pins a work to the top of its section, e.g. 'Last Words of a Lost Man'. */
    pinned: { type: Boolean, default: false },

    /** Unpublished works are visible to the admin only. */
    published: { type: Boolean, default: false },

    /**
     * TipTap/ProseMirror HTML, sanitized on write.
     *
     * For kind: 'document' this is the work itself — the poem or the song. For
     * kind: 'upload' it is the author's note about the book, shown above the reader;
     * the writing itself is still the PDF.
     */
    body: { type: String, default: '' },
    excerpt: { type: String, default: '' },

    /**
     * The first YouTube video embedded in the body, denormalized on write.
     *
     * The Songs shelf shows a thumbnail on every card, and the body is excluded from
     * list queries on purpose — reading sixteen documents to find sixteen ids would
     * undo that. Derived, never edited: it is refreshed on every body save.
     */
    videoId: { type: String, default: '' },

    /**
     * kind: 'upload' — the document itself.
     *
     * `storage` records where the bytes actually live. R2 when it is configured,
     * otherwise inline in `data` as before. Both are supported at once so existing
     * uploads keep working after R2 is switched on; nothing needs migrating.
     */
    pdf: {
      storage: { type: String, enum: ['mongo', 'r2'], default: 'mongo' },
      objectKey: { type: String, default: null },
      data: { type: Buffer, default: null },
      contentType: { type: String, default: null },
      byteSize: { type: Number, default: 0 },
      pageCount: { type: Number, default: null },
      originalName: { type: String, default: null },
      uploadedAt: { type: Date, default: null },
    },

    readingMinutes: { type: Number, default: null },
    sortOrder: { type: Number, default: 0 },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

workSchema.index({ section: 1, slug: 1 }, { unique: true });

/**
 * The PDF buffer is many megabytes and must never ride along in a list response.
 * Excluding it at the schema level makes inclusion opt-in and explicit, so no
 * future query can leak it by omission.
 */
workSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    if (ret.pdf) {
      ret.pdf = {
        hasFile: Boolean(ret.pdf.byteSize),
        byteSize: ret.pdf.byteSize,
        pageCount: ret.pdf.pageCount,
        originalName: ret.pdf.originalName,
        uploadedAt: ret.pdf.uploadedAt,
      };
    }
    delete ret._id;
    return ret;
  },
});

export const WORK_LIST_PROJECTION = '-pdf.data -body';

export const Work = mongoose.model('Work', workSchema);
