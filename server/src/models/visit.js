import mongoose from 'mongoose';

/** How a reader arrived. Coarse on purpose — a category, never a full referrer URL. */
export const SOURCES = ['instagram', 'google', 'direct', 'other'];

/**
 * One document per page a reader opened, kept alive by a heartbeat while the tab is
 * visible. It does two jobs at once: counted, it is the view total; filtered to the
 * ones still beating, it is who is on the site right now. A second "presence"
 * collection would only be a copy of the newest few of these.
 *
 * Nothing here identifies a person. `visitorId` is the same random value the browser
 * already mints for reactions; there is no IP address, no user agent and no cookie.
 */
const visitSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true },

    /** One per browser tab, so a reader who moves on is one row in the live list, not two. */
    tabId: { type: String, default: '' },

    path: { type: String, required: true },
    /** 'home' | 'about' | one of SECTIONS. Resolved by the server from `path`. */
    section: { type: String, required: true },
    title: { type: String, required: true },

    /** PDF progress, reported by the reader on each beat. */
    page: { type: Number, default: null },
    pages: { type: Number, default: null },

    source: { type: String, enum: SOURCES, default: 'direct' },
    /** The tag of the link that brought them — `?via=…` — or empty. */
    via: { type: String, default: '' },
    /** True on the first page of a session only: this is what a link "open" counts. */
    landing: { type: Boolean, default: false },

    startedAt: { type: Date, default: Date.now },
    seenAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

visitSchema.index({ startedAt: -1 });
visitSchema.index({ seenAt: -1 });
visitSchema.index({ via: 1, landing: 1 });

/**
 * A link the author made to tell one placement — or one person — from another.
 * The tag is the whole mechanism: Instagram reports nothing about who tapped, so the
 * only thing a visit can carry is which link it came through.
 */
const trackedLinkSchema = new mongoose.Schema(
  {
    tag: { type: String, required: true, unique: true },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    /** Where the link lands, e.g. `/poems/the-first-second`. */
    path: { type: String, default: '/' },
  },
  { timestamps: true, versionKey: false },
);

export const Visit = mongoose.model('Visit', visitSchema);
export const TrackedLink = mongoose.model('TrackedLink', trackedLinkSchema);
