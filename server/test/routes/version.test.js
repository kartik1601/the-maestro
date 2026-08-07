import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Page } from '../../src/models/page.js';
import { Post } from '../../src/models/post.js';
import { SECTIONS, Work } from '../../src/models/work.js';
import { signIn } from '../helpers/fixtures.js';
import {
  clearDatabase,
  request,
  startDatabase,
  startServer,
  stopDatabase,
  stopServer,
} from '../helpers/harness.js';

let baseUrl;
let token;

const version = () => request(baseUrl, 'GET', '/api/version');
const versionAsAuthor = () => request(baseUrl, 'GET', '/api/version', { token });

/** A published work, which is what a reader's poll is allowed to be told about. */
const seedWork = (overrides = {}) =>
  Work.create({
    section: 'poems',
    kind: 'document',
    title: 'A',
    slug: 'a',
    published: true,
    ...overrides,
  });

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

describe('GET /api/version', () => {
  it('reports nulls when there is nothing yet', async () => {
    const response = await version();

    assert.equal(response.status, 200);
    assert.equal(response.body.posts, null);
    assert.deepEqual(Object.keys(response.body.works).sort(), [...SECTIONS].sort());
    assert.ok(Object.values(response.body.works).every((value) => value === null));
    assert.deepEqual(response.body.pages, {});
  });

  it('is never cached, or the whole point is lost', async () => {
    assert.equal((await version()).headers.get('cache-control'), 'no-store');
  });

  it('reports the newest timestamp in each collection', async () => {
    await Post.create({ body: '<p>A post</p>', published: true });
    await seedWork();

    const { body } = await version();
    assert.ok(body.posts);
    assert.ok(body.works.poems);
  });

  it('keys pages by slug, so an edit to Novels does not prompt a Poems reader', async () => {
    await Page.create({ slug: 'poems', title: 'Poems' });
    await Page.create({ slug: 'novels', title: 'Novels' });

    const { body } = await version();
    assert.deepEqual(Object.keys(body.pages).sort(), ['novels', 'poems']);
  });

  it('moves on when a work is saved', async () => {
    const work = await seedWork();
    const before = (await version()).body.works.poems;

    // Mongo timestamps have millisecond resolution; without this the two saves can
    // land inside the same millisecond and the test would assert nothing.
    await new Promise((resolve) => setTimeout(resolve, 5));
    work.title = 'A, revised';
    await work.save();

    assert.notEqual((await version()).body.works.poems, before);
  });

  it('leaves the other collections alone when one changes', async () => {
    await Post.create({ body: '<p>A post</p>', published: true });
    const first = await version();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await seedWork();

    const second = await version();
    assert.equal(second.body.posts, first.body.posts);
    assert.notEqual(second.body.works.poems, first.body.works.poems);
  });

  it('keys works by section, so a song saved is not news on the Poems shelf', async () => {
    await seedWork({ section: 'songs', slug: 'a-song' });

    const { body } = await version();
    assert.ok(body.works.songs);
    assert.equal(body.works.poems, null);
  });

  describe('what a reader is allowed to be told about', () => {
    it('says nothing about a draft — a refresh would bring back the same page', async () => {
      await seedWork({ published: false });

      assert.equal((await version()).body.works.poems, null);
      assert.ok((await versionAsAuthor()).body.works.poems, 'the author still sees their own');
    });

    it('says nothing about an unpublished post', async () => {
      await Post.create({ body: '<p>Not yet</p>', published: false });

      assert.equal((await version()).body.posts, null);
      assert.ok((await versionAsAuthor()).body.posts);
    });

    it('says nothing about an unpublished page', async () => {
      await Page.create({ slug: 'poems', title: 'Poems', published: false });

      assert.deepEqual((await version()).body.pages, {});
      assert.ok((await versionAsAuthor()).body.pages.poems);
    });
  });

  it('names who the answer was counted for, so the client can tell a session change from an edit', async () => {
    assert.equal((await version()).body.audience, 'reader');
    assert.equal((await versionAsAuthor()).body.audience, 'author');
  });

  it('stamps when it answered', async () => {
    const { body } = await version();
    assert.ok(!Number.isNaN(Date.parse(body.checkedAt)));
  });

  it('needs no session — it is what every reader polls', async () => {
    assert.equal((await version()).status, 200);
  });
});

describe('GET /api/health', () => {
  it('answers without a session', async () => {
    const response = await request(baseUrl, 'GET', '/api/health');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
  });
});

describe('unknown routes', () => {
  it('answer 404 in the same shape as everything else', async () => {
    const response = await request(baseUrl, 'GET', '/api/nothing-here');

    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'Not found');
  });
});
