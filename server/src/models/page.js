import mongoose from 'mongoose';

/**
 * The author's details panel on the About page. Age is deliberately absent — it is
 * derived from `bornOn` at render time, because a stored age is wrong within a year
 * of being written.
 */
const profileSchema = new mongoose.Schema(
  {
    photoUrl: { type: String, default: '' },
    bornOn: { type: Date, default: null },
    profession: { type: String, default: '' },
    personality: { type: String, default: '' },
  },
  { _id: false },
);

const dialogueLineSchema = new mongoose.Schema(
  {
    speaker: { type: String, default: '' },
    line: { type: String, default: '' },
  },
  { _id: false },
);

/**
 * One document per page of the site — the blogs feed, each of the five sections, and
 * About. Every visible string lives here rather than in the client, so the author can
 * rewrite any of it in place and readers see the change without a redeploy.
 *
 * Fields are shared where they mean the same thing (`title`, `subtitle`) and
 * page-specific where they do not (`verse` on blogs, `dialogue` on novels, `profile`
 * on about). A page simply leaves unused fields empty.
 */
const pageSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },

    /** The page's main heading, and the line beneath it. */
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },

    /** Long-form rich text. Currently only About uses it. */
    body: { type: String, default: '' },

    /** Blogs: the epigraph that opens the page, one array entry per line. */
    verse: { type: [String], default: [] },
    verseSource: { type: String, default: '' },

    /** Novels: the quoted exchange above the shelf. */
    dialogue: { type: [dialogueLineSchema], default: [] },
    dialogueSource: { type: String, default: '' },

    /** About: the author's details. */
    profile: { type: profileSchema, default: () => ({}) },

    published: { type: Boolean, default: true },

    /**
     * Exactly what the seeder last wrote, field by field. If the page still matches
     * this, nobody has edited it and the seeder may refresh it from the template;
     * once the author saves anything, the two diverge and the seeder backs off.
     *
     * A stored snapshot rather than a hash, because a hash also has to encode *which*
     * fields were hashed — adding one field to the template would change every hash
     * and make untouched pages look edited. Comparing values sidesteps that entirely.
     *
     * Timestamps cannot serve this purpose either: Mongoose bumps `updatedAt` on
     * every `updateOne`, including the seeder's own no-op upserts.
     */
    seedSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

pageSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    delete ret.seedSnapshot;
    return ret;
  },
});

export const Page = mongoose.model('Page', pageSchema);
