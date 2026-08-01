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
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
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

export const sanitizeRichText = (html) => sanitizeHtml(String(html ?? ''), OPTIONS);

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
