export type Section = 'novels' | 'poems' | 'songs' | 'plays' | 'novelettes';
export type WorkKind = 'document' | 'upload';

export type Emote = 'heart' | 'flame' | 'tears' | 'wonder' | 'headphones' | 'candle';

/** Glyph and label for each emote. The set is closed and mirrors EMOTES on the server. */
export const EMOTE_META: Record<Emote, { glyph: string; label: string }> = {
  heart: { glyph: '❤️', label: 'Loved this' },
  flame: { glyph: '🔥', label: 'This burns' },
  tears: { glyph: '🥲', label: 'Moved me' },
  wonder: { glyph: '✨', label: 'Wonder' },
  headphones: { glyph: '🎧', label: 'Heard it' },
  candle: { glyph: '🕯️', label: 'Held quietly' },
};

export const EMOTE_ORDER: Emote[] = ['heart', 'flame', 'tears', 'wonder', 'headphones', 'candle'];

export interface PdfMeta {
  hasFile: boolean;
  byteSize: number;
  pageCount: number | null;
  originalName: string | null;
  uploadedAt: string | null;
}

export interface Work {
  id: string;
  section: Section;
  kind: WorkKind;
  title: string;
  slug: string;
  subtitle: string;
  summary: string;
  collectionKey: string;
  seriesNumber: number | null;
  /** The word in the title that carries the shelf tint. Empty means none. */
  tintWord: string;
  pinned: boolean;
  published: boolean;
  excerpt: string;
  readingMinutes: number | null;
  publishedAt: string | null;
  updatedAt: string;
  body?: string;
  pdf: PdfMeta;
}

export interface Profile {
  photoUrl: string;
  /** ISO date. Age is always derived from this, never stored. */
  bornOn: string | null;
  profession: string;
  personality: string;
}

export interface DialogueLine {
  speaker: string;
  line: string;
}

/**
 * A page's editable copy. Every visible string on the site comes from one of these,
 * so the author can rewrite any of it without a redeploy.
 */
export interface Page {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  body: string;
  verse: string[];
  verseSource: string;
  dialogue: DialogueLine[];
  dialogueSource: string;
  profile?: Profile;
  published: boolean;
  updatedAt: string;
}

export interface LinkedWork {
  title: string;
  slug: string;
  section: Section;
  collectionKey: string;
}

export interface Post {
  id: string;
  body: string;
  linkedWork: LinkedWork | null;
  pinned: boolean;
  published: boolean;
  createdAt: string;
  updatedAt: string;
  reactionCounts: Record<Emote, number>;
  myReactions: Emote[];
}

export interface Feed {
  emotes: Emote[];
  posts: Post[];
}

export interface ReactionResult {
  emote: Emote;
  reacted: boolean;
  counts: Record<Emote, number>;
}

export interface SectionMeta {
  key: Section | 'about' | 'blogs';
  label: string;
  path: string;
  tagline: string;
  /** Whether the link should only highlight on an exact URL match. */
  exact?: boolean;
}

/**
 * Navigation order. Labels are structural rather than content — they name the routes
 * themselves, which is why they are not stored in MongoDB alongside the page copy.
 */
export const SECTION_META: SectionMeta[] = [
  // The home feed is called Blogs everywhere it is named.
  { key: 'blogs', label: 'Blogs', path: '/', tagline: '', exact: true },
  { key: 'novels', label: 'Novels', path: '/novels', tagline: '' },
  { key: 'poems', label: 'Poems', path: '/poems', tagline: '' },
  { key: 'songs', label: 'Songs', path: '/songs', tagline: '' },
  { key: 'plays', label: 'Plays', path: '/plays', tagline: '' },
  { key: 'novelettes', label: 'Novelettes', path: '/novelettes', tagline: '' },
  { key: 'about', label: 'About the Author', path: '/about', tagline: '' },
];
