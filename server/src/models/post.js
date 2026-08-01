import mongoose from 'mongoose';

/** Viewers react with emotes only — there are no comments anywhere on this site. */
export const EMOTES = ['heart', 'flame', 'tears', 'wonder', 'headphones', 'candle'];

/**
 * One reaction document per (post, reactor, emote). A unique index enforces
 * "one of each emote per person" in the database, which keeps the count honest
 * even under concurrent taps from the same client.
 *
 * Reactors are anonymous: the client mints a random id into localStorage. That is
 * enough to let someone undo their own reaction without any account or tracking.
 */
const reactionSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    reactorId: { type: String, required: true },
    emote: { type: String, enum: EMOTES, required: true },
  },
  { timestamps: true },
);

reactionSchema.index({ post: 1, reactorId: 1, emote: 1 }, { unique: true });

const postSchema = new mongoose.Schema(
  {
    body: { type: String, required: true, trim: true, maxlength: 5000 },

    /** Optional pointer to a work, so a status can announce a new piece. */
    linkedWork: { type: mongoose.Schema.Types.ObjectId, ref: 'Work', default: null },

    /** Denormalized tallies — reading a feed must not aggregate the reactions collection. */
    reactionCounts: {
      type: Map,
      of: Number,
      default: () => new Map(EMOTES.map((emote) => [emote, 0])),
    },

    pinned: { type: Boolean, default: false },
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

postSchema.index({ pinned: -1, createdAt: -1 });

postSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    if (ret.reactionCounts instanceof Map) {
      ret.reactionCounts = Object.fromEntries(ret.reactionCounts);
    }
    delete ret._id;
    return ret;
  },
});

export const Post = mongoose.model('Post', postSchema);
export const Reaction = mongoose.model('Reaction', reactionSchema);
