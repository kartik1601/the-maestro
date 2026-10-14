import mongoose from 'mongoose';

/**
 * The letter itself: one document, written only by `npm run letter:set`.
 *
 * `answerHash` is scrypt over a peppered HMAC of all four answers joined — one hash
 * rather than four, so a guess learns nothing about which field it got wrong, and the
 * database never holds anything that could be tested a field at a time.
 *
 * `greetings` are the names the opening animation steps through. They live here and
 * not in the client, because the client bundle is public and the names are hers.
 */
const letterSchema = new mongoose.Schema(
  {
    singleton: { type: String, default: 'letter', unique: true, immutable: true },
    answerHash: { type: String, required: true },
    greetings: { type: [String], default: [] },
  },
  { timestamps: true, versionKey: false },
);

export const Letter = mongoose.model('Letter', letterSchema);

/**
 * One per network address that has got the answers wrong. Looked up by a peppered
 * digest of the address; the address itself is kept beside it only so the author can
 * see it on Pulse and lift a block. The document deletes itself once nothing in it
 * still applies, so a clean slate needs no job to clear it.
 */
const letterGuardSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    ip: { type: String, default: '' },

    /** Wrong answers since `firstStrikeAt`. Three inside a day blocks the address. */
    strikes: { type: Number, default: 0 },
    firstStrikeAt: { type: Date, default: null },

    /** No answers accepted before this, unless the author's code lifts it. */
    cooldownUntil: { type: Date, default: null },
    blockedUntil: { type: Date, default: null },

    /**
     * Whether a code has been asked for since the last strike. A code is mailed to the
     * author only once the reader gives their Gmail, and only once per strike — the
     * author's inbox is not something a stranger gets to fill.
     */
    otpRequested: { type: Boolean, default: false },
    /** The address the reader gave when asking for a code, shown to the author. */
    email: { type: String, default: '' },

    /** The bypass code, as a digest. Valid until the cooldown it would lift ends. */
    otpDigest: { type: String, default: null },
    otpTriesLeft: { type: Number, default: 0 },

    expireAt: { type: Date, required: true },
  },
  { versionKey: false },
);

letterGuardSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const LetterGuard = mongoose.model('LetterGuard', letterGuardSchema);

/** Everything that happened at the gate, for the author's Pulse page. Kept half a year. */
export const LETTER_EVENTS = [
  'unlocked',
  'wrong',
  'blocked',
  'otp-requested',
  'otp-accepted',
  'otp-wrong',
  'unblocked',
];

const letterEventSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: LETTER_EVENTS, required: true },
    ip: { type: String, default: '' },
    email: { type: String, default: '' },
    /** Strikes on that address once this happened. */
    strikes: { type: Number, default: 0 },
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

// Serves the newest-first listing too; an index reads equally well in either direction.
letterEventSchema.index({ at: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export const LetterEvent = mongoose.model('LetterEvent', letterEventSchema);
