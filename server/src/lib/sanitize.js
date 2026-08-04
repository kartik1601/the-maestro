import sanitizeHtml from 'sanitize-html';

/**
 * The editor is admin-only, but stored HTML is served to every visitor — so it is
 * sanitized on write regardless. If the author's session is ever stolen, the blast
 * radius stops at "bad formatting" instead of "script running for every reader".
 */
const OPTIONS = {
  allowedTags: [
    'p', 'br', 'hr', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'strong', 'em', 'u', 's', 'mark', 'sub', 'sup', 'span',
    'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    // Carries an embedded video as a data attribute; see the note below.
    'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    /**
     * A video is stored as `<div data-youtube="ID">`, never as an iframe — iframes
     * stay stripped, and the player is built from the id at render time. That keeps
     * the one thing an editor can embed to a known host with a validated id, instead
     * of trusting whatever markup arrives.
     *
     * Audio follows the same shape: `<div data-audio="/api/media/ID">` rather than an
     * `<audio>` element, so the player — and the source it is given — is built by our
     * own code from a reference this site issued.
     */
    div: ['data-youtube', 'data-audio', 'data-title'],
    span: ['style'],
    p: ['style'],
    h1: ['style'], h2: ['style'], h3: ['style'],
    td: ['colspan', 'rowspan', 'style'],
    th: ['colspan', 'rowspan', 'style'],
    '*': ['class'],
  },
  // Inline styles are limited to what the toolbar can actually produce.
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\(/],
      'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\(/],
      'text-align': [/^(left|right|center|justify)$/],
    },
  },
  // data: URIs are permitted for images so pasted/inline art survives a round trip.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  transformTags: {
    // Anything opening a new tab must not hand the opener over with it.
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
  },
};

/**
 * A media reference carrying somebody's host — `http://localhost:4000/api/media/…`.
 *
 * The client stores the relative form, but the server is where "what is in the
 * database" is actually decided, and a document is only portable between the author's
 * laptop and the deployed site if that holds for every write. An older bundle, a
 * pasted fragment, or a hand-edited body would otherwise pin a file to a host that
 * exists for nobody else.
 */
const ABSOLUTE_MEDIA = /(\s(?:src|data-audio)=")https?:\/\/[^/"]+(\/api\/media\/[a-f\d]{24})/gi;

export const sanitizeRichText = (html) =>
  sanitizeHtml(String(html ?? ''), OPTIONS).replace(ABSOLUTE_MEDIA, '$1$2');

/** Plain-text preview for cards and listings, collapsed to a single line. */
export function excerptFrom(html, maxLength = 220) {
  const text = sanitizeHtml(String(html ?? ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Rough reading time; the author writes prose, so 200 wpm is the right constant. */
export function readingMinutes(html) {
  const words = sanitizeHtml(String(html ?? ''), { allowedTags: [], allowedAttributes: {} })
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
