import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { excerptFrom, readingMinutes, sanitizeRichText } from '../../src/lib/sanitize.js';

const ID = '507f1f77bcf86cd799439011';

describe('sanitizeRichText', () => {
  it('keeps the formatting the editor can produce', () => {
    const html = '<p><strong>Bold</strong> and <em>italic</em> and <mark>marked</mark></p>';
    assert.equal(sanitizeRichText(html), html);
  });

  it('keeps headings, lists, quotes and tables', () => {
    const html =
      '<h2>Title</h2><ul><li>One</li></ul><blockquote>Said</blockquote>' +
      '<table><tbody><tr><td>Cell</td></tr></tbody></table>';
    assert.equal(sanitizeRichText(html), html);
  });

  it('strips a script tag and its contents', () => {
    const clean = sanitizeRichText('<p>Before</p><script>alert(1)</script><p>After</p>');
    assert.ok(!clean.includes('script'));
    assert.ok(!clean.includes('alert'));
    assert.equal(clean, '<p>Before</p><p>After</p>');
  });

  it('strips an iframe, which is why videos are stored as a data attribute', () => {
    const clean = sanitizeRichText('<iframe src="https://youtube.com/embed/x"></iframe>');
    assert.equal(clean, '');
  });

  it('strips inline event handlers', () => {
    const clean = sanitizeRichText('<p onclick="steal()">Text</p>');
    assert.equal(clean, '<p>Text</p>');
  });

  it('strips a javascript: URL', () => {
    const clean = sanitizeRichText('<a href="javascript:alert(1)">Click</a>');
    assert.ok(!clean.includes('javascript:'));
  });

  it('adds rel to anything opening a new tab, so the opener is not handed over', () => {
    const clean = sanitizeRichText('<a href="https://example.com" target="_blank">Link</a>');
    assert.ok(clean.includes('rel="noopener noreferrer"'));
  });

  it('keeps an embedded video as the data attribute the renderer reads', () => {
    const html = '<div data-youtube="dQw4w9WgXcQ" data-title="A song"></div>';
    assert.equal(sanitizeRichText(html), html);
  });

  it('keeps an embedded recording the same way', () => {
    const html = `<div data-audio="/api/media/${ID}"></div>`;
    assert.equal(sanitizeRichText(html), html);
  });

  it('rewrites a media reference that carries somebody else’s host', () => {
    const clean = sanitizeRichText(`<img src="http://localhost:4000/api/media/${ID}">`);
    assert.equal(clean, `<img src="/api/media/${ID}" />`);
  });

  it('rewrites an absolute audio reference too', () => {
    const clean = sanitizeRichText(
      `<div data-audio="https://themaestro.co.in/api/media/${ID}"></div>`,
    );
    assert.equal(clean, `<div data-audio="/api/media/${ID}"></div>`);
  });

  it('allows a data: URI for an image so pasted art survives', () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=" />';
    assert.ok(sanitizeRichText(html).includes('data:image/png'));
  });

  it('refuses a data: URI anywhere else', () => {
    const clean = sanitizeRichText('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    assert.ok(!clean.includes('data:text/html'));
  });

  it('keeps the inline styles the toolbar produces', () => {
    const clean = sanitizeRichText('<p style="text-align:center">Centred</p>');
    assert.ok(clean.includes('text-align:center'));
  });

  it('drops a style the toolbar cannot produce', () => {
    const clean = sanitizeRichText('<p style="position:fixed;top:0">Overlay</p>');
    assert.ok(!clean.includes('position'));
  });

  it('survives nothing at all', () => {
    assert.equal(sanitizeRichText(''), '');
    assert.equal(sanitizeRichText(null), '');
    assert.equal(sanitizeRichText(undefined), '');
  });
});

describe('excerptFrom', () => {
  it('reduces markup to a single line of text', () => {
    assert.equal(excerptFrom('<h2>Requiem</h2><p>When the world ends</p>'), 'RequiemWhen the world ends');
  });

  it('collapses whitespace', () => {
    assert.equal(excerptFrom('<p>Two\n\n  words</p>'), 'Two words');
  });

  it('truncates with an ellipsis past the limit', () => {
    const excerpt = excerptFrom(`<p>${'word '.repeat(100)}</p>`);
    assert.equal(excerpt.length, 220);
    assert.ok(excerpt.endsWith('…'));
  });

  it('leaves a short body whole, with no ellipsis', () => {
    assert.equal(excerptFrom('<p>Short</p>'), 'Short');
  });

  it('honours a caller-supplied limit', () => {
    assert.equal(excerptFrom('<p>abcdefghij</p>', 5), 'abcd…');
  });

  it('is empty for an empty body', () => {
    assert.equal(excerptFrom(''), '');
    assert.equal(excerptFrom('<p></p>'), '');
    assert.equal(excerptFrom(null), '');
  });
});

describe('readingMinutes', () => {
  it('counts at 200 words a minute', () => {
    assert.equal(readingMinutes(`<p>${'word '.repeat(400)}</p>`), 2);
    assert.equal(readingMinutes(`<p>${'word '.repeat(1000)}</p>`), 5);
  });

  it('never reports less than a minute', () => {
    assert.equal(readingMinutes('<p>Three short words</p>'), 1);
    assert.equal(readingMinutes(''), 1);
  });

  it('counts the words, not the markup', () => {
    const bare = readingMinutes(`${'word '.repeat(400)}`);
    const wrapped = readingMinutes(
      `<div class="x"><p><strong>${'word '.repeat(400)}</strong></p></div>`,
    );
    assert.equal(bare, wrapped);
  });
});
