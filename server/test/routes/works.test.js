import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Work } from '../../src/models/work.js';
import {
  clearDatabase,
  request,
  startDatabase,
  startServer,
  stopDatabase,
  stopServer,
} from '../helpers/harness.js';
import { multipart, pdfBytes, signIn } from '../helpers/fixtures.js';

let baseUrl;
let token;

const asAuthor = (method, path, options = {}) =>
  request(baseUrl, method, path, { token, ...options });
const asReader = (method, path, options = {}) => request(baseUrl, method, path, options);

/** A work straight into the database, bypassing the route under test. */
const seedWork = (overrides = {}) =>
  Work.create({
    section: 'poems',
    kind: 'document',
    title: 'Requiem',
    slug: 'requiem',
    collectionKey: 'others',
    published: true,
    ...overrides,
  });

before(async () => {
  await startDatabase();
  baseUrl = await startServer();

  /**
   * Signed in once for the whole file. The access token is a stateless JWT and
   * `requireAdmin` never consults the database, so clearing collections between
   * tests does not end the session — and hashing three factors per test would
   * dominate the runtime for no added coverage. Login itself is covered in
   * auth.test.js.
   */
  ({ token } = await signIn(baseUrl));
});

after(async () => {
  await stopServer();
  await stopDatabase();
});

beforeEach(clearDatabase);

describe('GET /api/works/:section', () => {
  it('lists the published works of a section', async () => {
    await seedWork({ slug: 'one', title: 'One' });
    await seedWork({ slug: 'two', title: 'Two' });

    const response = await asReader('GET', '/api/works/poems');

    assert.equal(response.status, 200);
    assert.equal(response.body.section, 'poems');
    assert.equal(response.body.works.length, 2);
  });

  it('hides drafts from a reader', async () => {
    await seedWork({ slug: 'draft', published: false });
    const response = await asReader('GET', '/api/works/poems');
    assert.equal(response.body.works.length, 0);
  });

  it('shows drafts to the author', async () => {
    await seedWork({ slug: 'draft', published: false });
    const response = await asAuthor('GET', '/api/works/poems');
    assert.equal(response.body.works.length, 1);
    assert.equal(response.body.works[0].published, false);
  });

  it('never sends a work from another section', async () => {
    await seedWork({ section: 'novels', kind: 'upload', slug: 'a-novel' });
    const response = await asReader('GET', '/api/works/poems');
    assert.equal(response.body.works.length, 0);
  });

  it('narrows to one sub-section on request', async () => {
    await seedWork({ slug: 'rain', collectionKey: 'rains-of-love' });
    await seedWork({ slug: 'other', collectionKey: 'others' });

    const response = await asReader('GET', '/api/works/poems?collection=rains-of-love');
    assert.equal(response.body.works.length, 1);
    assert.equal(response.body.works[0].slug, 'rain');
  });

  it('puts the pinned work first, whatever its title', async () => {
    await seedWork({ section: 'novelettes', kind: 'upload', slug: 'a-morkan', title: 'Morkan' });
    await seedWork({
      section: 'novelettes',
      kind: 'upload',
      slug: 'last-words',
      title: 'Last Words of a Lost Man',
      pinned: true,
    });

    const response = await asReader('GET', '/api/works/novelettes');
    assert.equal(response.body.works[0].slug, 'last-words');
  });

  it('orders a series by its number', async () => {
    await seedWork({ section: 'novels', kind: 'upload', slug: 'b', seriesNumber: 2 });
    await seedWork({ section: 'novels', kind: 'upload', slug: 'a', seriesNumber: 1 });

    const response = await asReader('GET', '/api/works/novels');
    assert.deepEqual(
      response.body.works.map((work) => work.slug),
      ['a', 'b'],
    );
  });

  it('leaves the body out of a listing', async () => {
    await seedWork({ body: '<p>A whole poem</p>' });
    const response = await asReader('GET', '/api/works/poems');
    assert.equal(response.body.works[0].body, undefined);
  });

  it('reports whether a work has a file, without sending the bytes', async () => {
    await seedWork({
      section: 'novels',
      kind: 'upload',
      slug: 'a-novel',
      pdf: { byteSize: 1234, pageCount: 300, storage: 'mongo' },
    });

    const [work] = (await asReader('GET', '/api/works/novels')).body.works;
    assert.equal(work.pdf.hasFile, true);
    assert.equal(work.pdf.pageCount, 300);
    assert.equal(work.pdf.data, undefined);
  });

  it('refuses a section that does not exist', async () => {
    const response = await asReader('GET', '/api/works/recipes');
    assert.equal(response.status, 404);
  });
});

describe('GET /api/works/:section/:slug', () => {
  it('returns the work with its body', async () => {
    await seedWork({ body: '<p>When the world ends</p>' });

    const response = await asReader('GET', '/api/works/poems/requiem');
    assert.equal(response.status, 200);
    assert.equal(response.body.body, '<p>When the world ends</p>');
  });

  it('hides a draft from a reader', async () => {
    await seedWork({ published: false });
    assert.equal((await asReader('GET', '/api/works/poems/requiem')).status, 404);
  });

  it('shows a draft to the author', async () => {
    await seedWork({ published: false });
    assert.equal((await asAuthor('GET', '/api/works/poems/requiem')).status, 200);
  });

  it('404s for a slug that is not there', async () => {
    assert.equal((await asReader('GET', '/api/works/poems/nothing')).status, 404);
  });
});

describe('POST /api/works', () => {
  it('creates a work and derives its slug from the title', async () => {
    const response = await asAuthor('POST', '/api/works', {
      body: { section: 'poems', title: 'Kings of False Ages' },
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.slug, 'kings-of-false-ages');
  });

  it('defaults poems and songs to documents, and everything else to uploads', async () => {
    const poem = await asAuthor('POST', '/api/works', {
      body: { section: 'poems', title: 'A Poem' },
    });
    const novel = await asAuthor('POST', '/api/works', {
      body: { section: 'novels', title: 'A Novel' },
    });

    assert.equal(poem.body.kind, 'document');
    assert.equal(novel.body.kind, 'upload');
  });

  it('refuses a work with no title', async () => {
    const response = await asAuthor('POST', '/api/works', { body: { section: 'poems' } });
    assert.equal(response.status, 400);
  });

  it('refuses an unknown section', async () => {
    const response = await asAuthor('POST', '/api/works', {
      body: { section: 'recipes', title: 'Bread' },
    });
    assert.equal(response.status, 400);
  });

  it('refuses a duplicate slug within a section', async () => {
    await asAuthor('POST', '/api/works', { body: { section: 'poems', title: 'Requiem' } });
    const second = await asAuthor('POST', '/api/works', {
      body: { section: 'poems', title: 'Requiem' },
    });

    assert.equal(second.status, 409);
  });

  it('allows the same slug in a different section', async () => {
    await asAuthor('POST', '/api/works', { body: { section: 'poems', title: 'Requiem' } });
    const other = await asAuthor('POST', '/api/works', {
      body: { section: 'songs', title: 'Requiem' },
    });

    assert.equal(other.status, 201);
  });

  it('sanitizes the body it is given', async () => {
    const response = await asAuthor('POST', '/api/works', {
      body: {
        section: 'poems',
        title: 'Unsafe',
        body: '<p>Safe</p><script>alert(1)</script>',
      },
    });

    assert.ok(!response.body.body.includes('script'));
  });

  it('derives the excerpt, reading time and video id from the body on save', async () => {
    const response = await asAuthor('POST', '/api/works', {
      body: {
        section: 'songs',
        title: 'A Cover',
        body: `<p>${'word '.repeat(400)}</p><div data-youtube="dQw4w9WgXcQ"></div>`,
      },
    });

    assert.equal(response.body.readingMinutes, 2);
    assert.equal(response.body.videoId, 'dQw4w9WgXcQ');
    assert.ok(response.body.excerpt.length > 0);
  });

  it('stamps the publication date on first publish', async () => {
    const response = await asAuthor('POST', '/api/works', {
      body: { section: 'poems', title: 'Published', published: true },
    });

    assert.ok(response.body.publishedAt);
  });

  it('is not there at all without a session', async () => {
    const response = await asReader('POST', '/api/works', {
      body: { section: 'poems', title: 'Sneaky' },
    });

    assert.equal(response.status, 404);
    assert.equal(await Work.countDocuments(), 0);
  });
});

describe('PATCH /api/works/:id', () => {
  it('changes only what it was sent', async () => {
    const work = await seedWork({ subtitle: 'A subtitle' });

    const response = await asAuthor('PATCH', `/api/works/${work.id}`, {
      body: { title: 'Requiem, revised' },
    });

    assert.equal(response.body.title, 'Requiem, revised');
    assert.equal(response.body.subtitle, 'A subtitle');
  });

  it('re-derives the excerpt when the body changes', async () => {
    const work = await seedWork({ body: '<p>Old</p>', excerpt: 'Old' });

    const response = await asAuthor('PATCH', `/api/works/${work.id}`, {
      body: { body: '<p>Something else entirely</p>' },
    });

    assert.equal(response.body.excerpt, 'Something else entirely');
  });

  it('lowercases a sub-section key, since that is what works are joined on', async () => {
    const work = await seedWork();
    const response = await asAuthor('PATCH', `/api/works/${work.id}`, {
      body: { collectionKey: 'Rains-Of-Love' },
    });

    assert.equal(response.body.collectionKey, 'rains-of-love');
  });

  it('404s for a work that is not there', async () => {
    const response = await asAuthor('PATCH', '/api/works/507f1f77bcf86cd799439011', {
      body: { title: 'x' },
    });
    assert.equal(response.status, 404);
  });

  describe('renaming', () => {
    it('moves the work to a slug made from its new title', async () => {
      const work = await seedWork({ title: 'Requiem', slug: 'requiem' });

      const response = await asAuthor('PATCH', `/api/works/${work.id}`, {
        body: { title: 'Bells of Requiem' },
      });

      assert.equal(response.body.slug, 'bells-of-requiem');
      assert.equal((await asReader('GET', '/api/works/poems/bells-of-requiem')).status, 200);
    });

    it('leaves the slug alone when the title is unchanged', async () => {
      const work = await seedWork({ title: 'Requiem', slug: 'an-old-address' });

      const response = await asAuthor('PATCH', `/api/works/${work.id}`, {
        body: { title: 'Requiem', subtitle: 'A subtitle' },
      });

      assert.equal(response.body.slug, 'an-old-address');
    });

    it('suffixes rather than failing when a sibling already holds that slug', async () => {
      await seedWork({ title: 'Requiem', slug: 'requiem' });
      const work = await seedWork({ title: 'Another', slug: 'another' });

      const response = await asAuthor('PATCH', `/api/works/${work.id}`, {
        body: { title: 'Requiem' },
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.slug, 'requiem-2');
    });

    it('honours a slug it was given explicitly', async () => {
      const work = await seedWork({ title: 'Requiem', slug: 'requiem' });

      const response = await asAuthor('PATCH', `/api/works/${work.id}`, {
        body: { title: 'Bells of Requiem', slug: 'Chosen By Hand' },
      });

      assert.equal(response.body.slug, 'chosen-by-hand');
    });

    it('ignores a namesake in another section', async () => {
      await seedWork({ section: 'songs', title: 'Requiem', slug: 'requiem' });
      const work = await seedWork({ title: 'Another', slug: 'another' });

      const response = await asAuthor('PATCH', `/api/works/${work.id}`, {
        body: { title: 'Requiem' },
      });

      assert.equal(response.body.slug, 'requiem');
    });
  });

  it('is not there at all without a session', async () => {
    const work = await seedWork();
    const response = await asReader('PATCH', `/api/works/${work.id}`, {
      body: { published: true },
    });

    assert.equal(response.status, 404);
  });
});

describe('PUT /api/works/reorder', () => {
  /** Three poems in one sub-section, listed in the order the shelf would show them. */
  const shelf = async () => {
    const one = await seedWork({ title: 'One', slug: 'one', sortOrder: 0 });
    const two = await seedWork({ title: 'Two', slug: 'two', sortOrder: 1 });
    const three = await seedWork({ title: 'Three', slug: 'three', sortOrder: 2 });
    return [one, two, three];
  };

  const listed = async () =>
    (await asReader('GET', '/api/works/poems')).body.works.map((work) => work.slug);

  it('lists the works in the order it was given', async () => {
    const [one, two, three] = await shelf();

    const response = await asAuthor('PUT', '/api/works/reorder', {
      body: { ids: [three.id, one.id, two.id] },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await listed(), ['three', 'one', 'two']);
  });

  it('refuses an empty order', async () => {
    const response = await asAuthor('PUT', '/api/works/reorder', { body: { ids: [] } });
    assert.equal(response.status, 400);
  });

  it('refuses anything that is not a work id', async () => {
    const response = await asAuthor('PUT', '/api/works/reorder', {
      body: { ids: ['not-an-id'] },
    });
    assert.equal(response.status, 400);
  });

  it('is not there at all without a session', async () => {
    const [one, two, three] = await shelf();

    const response = await asReader('PUT', '/api/works/reorder', {
      body: { ids: [three.id, two.id, one.id] },
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await listed(), ['one', 'two', 'three']);
  });
});

describe('DELETE /api/works/:id', () => {
  it('removes the work', async () => {
    const work = await seedWork();

    assert.equal((await asAuthor('DELETE', `/api/works/${work.id}`)).status, 204);
    assert.equal(await Work.countDocuments(), 0);
  });

  it('404s for a work that is not there', async () => {
    const response = await asAuthor('DELETE', '/api/works/507f1f77bcf86cd799439011');
    assert.equal(response.status, 404);
  });

  it('is not there at all without a session', async () => {
    const work = await seedWork();
    assert.equal((await asReader('DELETE', `/api/works/${work.id}`)).status, 404);
    assert.equal(await Work.countDocuments(), 1);
  });
});

describe('PDF upload', () => {
  const upload = async (id, { filename = 'book.pdf', type = 'application/pdf', bytes } = {}) => {
    const form = multipart('pdf', filename, type, bytes ?? pdfBytes(3));
    return asAuthor('PUT', `/api/works/${id}/pdf`, {
      raw: form.body,
      headers: { 'content-type': form.contentType },
    });
  };

  it('stores the file and reports it on the work', async () => {
    const work = await seedWork({ section: 'novels', kind: 'upload', slug: 'a-novel' });

    const response = await upload(work.id);

    assert.equal(response.status, 200);
    assert.equal(response.body.pdf.hasFile, true);
    assert.equal(response.body.pdf.originalName, 'book.pdf');
    assert.equal(response.body.pdf.pageCount, 3);
  });

  it('serves the bytes back', async () => {
    const work = await seedWork({ section: 'novels', kind: 'upload', slug: 'a-novel' });
    await upload(work.id);

    const response = await asReader('GET', '/api/works/novels/a-novel/pdf');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
  });

  it('tells the client the bytes are in the database rather than object storage', async () => {
    const work = await seedWork({ section: 'novels', kind: 'upload', slug: 'a-novel' });
    await upload(work.id);

    const response = await asReader('GET', '/api/works/novels/a-novel/pdf-link');
    assert.equal(response.status, 200);
    assert.equal(response.body.url, null);
  });

  it('refuses anything that is not a PDF', async () => {
    const work = await seedWork({ section: 'novels', kind: 'upload', slug: 'a-novel' });

    const response = await upload(work.id, {
      filename: 'cover.png',
      type: 'image/png',
      bytes: Buffer.from('not a pdf'),
    });

    assert.equal(response.status, 415);
    assert.match(response.body.error, /Only PDF/);
  });

  it('never serves a draft to a reader', async () => {
    const work = await seedWork({
      section: 'novels',
      kind: 'upload',
      slug: 'a-draft',
      published: false,
    });
    await upload(work.id);

    assert.equal((await asReader('GET', '/api/works/novels/a-draft/pdf')).status, 404);
    assert.equal((await asAuthor('GET', '/api/works/novels/a-draft/pdf')).status, 200);
  });

  it('marks a draft as never cacheable', async () => {
    const work = await seedWork({
      section: 'novels',
      kind: 'upload',
      slug: 'a-draft',
      published: false,
    });
    await upload(work.id);

    const response = await asAuthor('GET', '/api/works/novels/a-draft/pdf');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  it('404s for a work with no file', async () => {
    await seedWork({ section: 'novels', kind: 'upload', slug: 'empty' });
    assert.equal((await asReader('GET', '/api/works/novels/empty/pdf')).status, 404);
  });

  it('removes the file but keeps the work', async () => {
    const work = await seedWork({ section: 'novels', kind: 'upload', slug: 'a-novel' });
    await upload(work.id);

    const response = await asAuthor('DELETE', `/api/works/${work.id}/pdf`);

    assert.equal(response.status, 200);
    assert.equal(response.body.pdf.hasFile, false);
    assert.equal(await Work.countDocuments(), 1);
  });

  it('is not there at all without a session', async () => {
    const work = await seedWork({ section: 'novels', kind: 'upload', slug: 'a-novel' });
    const form = multipart('pdf', 'book.pdf', 'application/pdf', pdfBytes(1));

    const response = await asReader('PUT', `/api/works/${work.id}/pdf`, {
      raw: form.body,
      headers: { 'content-type': form.contentType },
    });

    assert.equal(response.status, 404);
  });
});
