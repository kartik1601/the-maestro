import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Page } from '../../src/models/page.js';
import {
  clearDatabase,
  request,
  startDatabase,
  startServer,
  stopDatabase,
  stopServer,
} from '../helpers/harness.js';
import { signIn } from '../helpers/fixtures.js';

let baseUrl;
let token;

const asAuthor = (method, path, options = {}) =>
  request(baseUrl, method, path, { token, ...options });
const asReader = (method, path, options = {}) => request(baseUrl, method, path, options);

before(async () => {
  await startDatabase();
  baseUrl = await startServer();
  ({ token } = await signIn(baseUrl));
});

after(async () => {
  await stopServer();
  await stopDatabase();
});

beforeEach(clearDatabase);

describe('GET /api/pages/:slug', () => {
  it('returns a published page', async () => {
    await Page.create({ slug: 'poems', title: 'Poems', published: true });

    const response = await asReader('GET', '/api/pages/poems');
    assert.equal(response.status, 200);
    assert.equal(response.body.title, 'Poems');
  });

  it('is case-insensitive about the slug', async () => {
    await Page.create({ slug: 'poems', title: 'Poems', published: true });
    assert.equal((await asReader('GET', '/api/pages/POEMS')).status, 200);
  });

  it('hides an unpublished page from a reader', async () => {
    await Page.create({ slug: 'poems', title: 'Poems', published: false });
    assert.equal((await asReader('GET', '/api/pages/poems')).status, 404);
  });

  it('shows an unpublished page to the author', async () => {
    await Page.create({ slug: 'poems', title: 'Poems', published: false });
    assert.equal((await asAuthor('GET', '/api/pages/poems')).status, 200);
  });

  it('404s for a page that has never been written', async () => {
    assert.equal((await asReader('GET', '/api/pages/nothing')).status, 404);
  });
});

describe('PUT /api/pages/:slug', () => {
  it('creates a page that did not exist', async () => {
    const response = await asAuthor('PUT', '/api/pages/poems', {
      body: { title: 'Poems', subtitle: 'All for you.' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.slug, 'poems');
    assert.equal(response.body.subtitle, 'All for you.');
  });

  it('writes only the fields it was sent, leaving the rest alone', async () => {
    await asAuthor('PUT', '/api/pages/poems', {
      body: { title: 'Poems', subtitle: 'All for you.' },
    });

    const response = await asAuthor('PUT', '/api/pages/poems', { body: { title: 'Poetry' } });

    assert.equal(response.body.title, 'Poetry');
    assert.equal(response.body.subtitle, 'All for you.', 'an untouched field survives a save');
  });

  it('trims what it stores', async () => {
    const response = await asAuthor('PUT', '/api/pages/poems', {
      body: { title: '  Poems  ' },
    });
    assert.equal(response.body.title, 'Poems');
  });

  it('sanitizes the page body', async () => {
    const response = await asAuthor('PUT', '/api/pages/about', {
      body: { body: '<p>About</p><script>alert(1)</script>' },
    });

    assert.ok(!response.body.body.includes('script'));
  });

  describe('sub-sections', () => {
    it('stores them with keys works can point at', async () => {
      const response = await asAuthor('PUT', '/api/pages/poems', {
        body: {
          collections: [
            { label: 'Rains of Love', note: 'Written for her' },
            { label: 'All Others', note: 'Everything else' },
          ],
        },
      });

      assert.deepEqual(
        response.body.collections.map((entry) => entry.key),
        ['rains-of-love', 'all-others'],
      );
    });

    it('keeps the order the author put them in', async () => {
      const response = await asAuthor('PUT', '/api/pages/poems', {
        body: {
          collections: [
            { label: 'First' },
            { label: 'Second' },
          ],
        },
      });

      assert.deepEqual(
        response.body.collections.map((entry) => entry.sortOrder),
        [0, 1],
      );
    });

    it('drops a sub-section with nothing to key on', async () => {
      const response = await asAuthor('PUT', '/api/pages/poems', {
        body: { collections: [{ label: '' }, { label: 'Real' }] },
      });

      assert.equal(response.body.collections.length, 1);
    });

    it('drops a duplicate key, which would otherwise split a shelf in two', async () => {
      const response = await asAuthor('PUT', '/api/pages/poems', {
        body: {
          collections: [
            { label: 'Rains of Love' },
            { label: 'Rains of love' },
          ],
        },
      });

      assert.equal(response.body.collections.length, 1);
    });

    it('lets the author remove one', async () => {
      await asAuthor('PUT', '/api/pages/poems', {
        body: { collections: [{ label: 'One' }, { label: 'Two' }] },
      });

      const response = await asAuthor('PUT', '/api/pages/poems', {
        body: { collections: [{ label: 'One' }] },
      });

      assert.equal(response.body.collections.length, 1);
    });
  });

  describe('dialogue', () => {
    it('stores the exchange', async () => {
      const response = await asAuthor('PUT', '/api/pages/poems', {
        body: { dialogue: [{ speaker: 'Her', line: 'What is love?' }] },
      });

      assert.deepEqual(response.body.dialogue, [{ speaker: 'Her', line: 'What is love?' }]);
    });

    it('drops a row with neither a speaker nor a line', async () => {
      const response = await asAuthor('PUT', '/api/pages/poems', {
        body: {
          dialogue: [
            { speaker: '', line: '' },
            { speaker: '', line: 'Unattributed, but still a line' },
          ],
        },
      });

      assert.equal(response.body.dialogue.length, 1);
    });

    it('caps a line rather than storing an essay', async () => {
      const response = await asAuthor('PUT', '/api/pages/poems', {
        body: { dialogue: [{ speaker: 'x', line: 'y'.repeat(5000) }] },
      });

      assert.equal(response.body.dialogue[0].line.length, 2000);
    });
  });

  describe('verse', () => {
    it('accepts an array of lines', async () => {
      const response = await asAuthor('PUT', '/api/pages/about', {
        body: { verse: ['One', 'Two'] },
      });
      assert.deepEqual(response.body.verse, ['One', 'Two']);
    });

    it('accepts one newline-separated string', async () => {
      const response = await asAuthor('PUT', '/api/pages/about', {
        body: { verse: 'One\nTwo\n\nThree' },
      });
      assert.deepEqual(response.body.verse, ['One', 'Two', 'Three']);
    });

    it('caps the number of lines', async () => {
      const response = await asAuthor('PUT', '/api/pages/about', {
        body: { verse: Array.from({ length: 50 }, (_, i) => `Line ${i}`) },
      });
      assert.equal(response.body.verse.length, 24);
    });
  });

  describe('the author profile', () => {
    it('stores a date of birth as a date', async () => {
      const response = await asAuthor('PUT', '/api/pages/about', {
        body: { profile: { bornOn: '1999-05-04', profession: 'Writer' } },
      });

      assert.equal(new Date(response.body.profile.bornOn).getUTCFullYear(), 1999);
      assert.equal(response.body.profile.profession, 'Writer');
    });

    it('stores null rather than an invalid date', async () => {
      const response = await asAuthor('PUT', '/api/pages/about', {
        body: { profile: { bornOn: 'not a date' } },
      });

      assert.equal(response.body.profile.bornOn, null);
    });
  });

  it('is not there at all without a session', async () => {
    const response = await asReader('PUT', '/api/pages/poems', { body: { title: 'Hijacked' } });

    assert.equal(response.status, 404);
    assert.equal(await Page.countDocuments(), 0);
  });
});
