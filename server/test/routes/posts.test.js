import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { EMOTES, Post, Reaction } from '../../src/models/post.js';
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

const READER = 'reader-abcdef123456';
const OTHER_READER = 'other-abcdef123456';

const asAuthor = (method, path, options = {}) =>
  request(baseUrl, method, path, { token, ...options });
const asReader = (method, path, options = {}) =>
  request(baseUrl, method, path, { reactorId: READER, ...options });

const seedPost = (overrides = {}) =>
  Post.create({ body: '<p>A status</p>', published: true, ...overrides });

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

describe('GET /api/posts', () => {
  it('returns the feed and the closed set of emotes', async () => {
    await seedPost();

    const response = await asReader('GET', '/api/posts');

    assert.equal(response.status, 200);
    assert.equal(response.body.posts.length, 1);
    assert.deepEqual(response.body.emotes, EMOTES);
  });

  it('hides drafts from a reader', async () => {
    await seedPost({ published: false });
    assert.equal((await asReader('GET', '/api/posts')).body.posts.length, 0);
  });

  it('shows drafts to the author', async () => {
    await seedPost({ published: false });
    assert.equal((await asAuthor('GET', '/api/posts')).body.posts.length, 1);
  });

  it('puts pinned posts first, then the newest', async () => {
    await seedPost({ body: '<p>Old</p>', createdAt: new Date('2020-01-01') });
    await seedPost({ body: '<p>New</p>', createdAt: new Date('2026-01-01') });
    await seedPost({ body: '<p>Pinned</p>', pinned: true, createdAt: new Date('2019-01-01') });

    const bodies = (await asReader('GET', '/api/posts')).body.posts.map((post) => post.body);
    assert.deepEqual(bodies, ['<p>Pinned</p>', '<p>New</p>', '<p>Old</p>']);
  });

  it('tells a reader which reactions are their own', async () => {
    const post = await seedPost();
    await asReader('POST', `/api/posts/${post.id}/reactions`, { body: { emote: 'heart' } });

    const mine = (await asReader('GET', '/api/posts')).body.posts[0];
    assert.deepEqual(mine.myReactions, ['heart']);

    const theirs = (
      await request(baseUrl, 'GET', '/api/posts', { reactorId: OTHER_READER })
    ).body.posts[0];
    assert.deepEqual(theirs.myReactions, []);
  });

  it('reports every emote in the tally, including the untouched ones', async () => {
    await seedPost();
    const counts = (await asReader('GET', '/api/posts')).body.posts[0].reactionCounts;

    assert.deepEqual(Object.keys(counts).sort(), [...EMOTES].sort());
    assert.ok(Object.values(counts).every((count) => count === 0));
  });

  it('caps how much of the feed one request can ask for', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => seedPost({ body: `<p>${i}</p>` })));

    const response = await asReader('GET', '/api/posts?limit=5');
    assert.equal(response.body.posts.length, 5);
  });
});

describe('POST /api/posts/:id/reactions', () => {
  it('adds a reaction and returns the new tally', async () => {
    const post = await seedPost();

    const response = await asReader('POST', `/api/posts/${post.id}/reactions`, {
      body: { emote: 'heart' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.reacted, true);
    assert.equal(response.body.counts.heart, 1);
  });

  it('takes the reaction back on a second press', async () => {
    const post = await seedPost();
    await asReader('POST', `/api/posts/${post.id}/reactions`, { body: { emote: 'heart' } });

    const response = await asReader('POST', `/api/posts/${post.id}/reactions`, {
      body: { emote: 'heart' },
    });

    assert.equal(response.body.reacted, false);
    assert.equal(response.body.counts.heart, 0);
    assert.equal(await Reaction.countDocuments(), 0);
  });

  it('counts two readers separately', async () => {
    const post = await seedPost();

    await asReader('POST', `/api/posts/${post.id}/reactions`, { body: { emote: 'flame' } });
    const response = await request(baseUrl, 'POST', `/api/posts/${post.id}/reactions`, {
      reactorId: OTHER_READER,
      body: { emote: 'flame' },
    });

    assert.equal(response.body.counts.flame, 2);
  });

  it('lets one reader hold several emotes on the same post', async () => {
    const post = await seedPost();

    await asReader('POST', `/api/posts/${post.id}/reactions`, { body: { emote: 'heart' } });
    const response = await asReader('POST', `/api/posts/${post.id}/reactions`, {
      body: { emote: 'candle' },
    });

    assert.equal(response.body.counts.heart, 1);
    assert.equal(response.body.counts.candle, 1);
  });

  it('refuses an emote outside the closed set', async () => {
    const post = await seedPost();

    const response = await asReader('POST', `/api/posts/${post.id}/reactions`, {
      body: { emote: 'thumbsup' },
    });

    assert.equal(response.status, 400);
    assert.equal(await Reaction.countDocuments(), 0);
  });

  it('refuses a reaction with no reactor id to attribute it to', async () => {
    const post = await seedPost();

    const response = await request(baseUrl, 'POST', `/api/posts/${post.id}/reactions`, {
      body: { emote: 'heart' },
    });

    assert.equal(response.status, 400);
  });

  it('refuses a reactor id too short to be one', async () => {
    const post = await seedPost();

    const response = await request(baseUrl, 'POST', `/api/posts/${post.id}/reactions`, {
      reactorId: 'short',
      body: { emote: 'heart' },
    });

    assert.equal(response.status, 400);
  });

  it('404s for a post id that is not an id at all', async () => {
    const response = await asReader('POST', '/api/posts/not-an-id/reactions', {
      body: { emote: 'heart' },
    });
    assert.equal(response.status, 404);
  });

  it('404s for a post that is not there', async () => {
    const response = await asReader('POST', '/api/posts/507f1f77bcf86cd799439011/reactions', {
      body: { emote: 'heart' },
    });
    assert.equal(response.status, 404);
  });

  it('refuses a reaction to an unpublished post', async () => {
    const post = await seedPost({ published: false });

    const response = await asReader('POST', `/api/posts/${post.id}/reactions`, {
      body: { emote: 'heart' },
    });

    assert.equal(response.status, 404);
  });
});

describe('POST /api/posts', () => {
  it('creates a post', async () => {
    const response = await asAuthor('POST', '/api/posts', { body: { body: '<p>Hello</p>' } });

    assert.equal(response.status, 201);
    assert.equal(response.body.body, '<p>Hello</p>');
    assert.equal(response.body.published, true);
  });

  it('sanitizes what it stores', async () => {
    const response = await asAuthor('POST', '/api/posts', {
      body: { body: '<p>Hi</p><script>alert(1)</script>' },
    });

    assert.equal(response.body.body, '<p>Hi</p>');
  });

  it('refuses a post with nothing to say', async () => {
    assert.equal((await asAuthor('POST', '/api/posts', { body: { body: '' } })).status, 400);
    assert.equal(
      (await asAuthor('POST', '/api/posts', { body: { body: '<script>x</script>' } })).status,
      400,
      'a post that is nothing but markup the sanitizer removes is empty',
    );
  });

  it('ignores a linked work that is not an id', async () => {
    const response = await asAuthor('POST', '/api/posts', {
      body: { body: '<p>Hi</p>', linkedWork: 'not-an-id' },
    });

    assert.equal(response.body.linkedWork, null);
  });

  it('can be created as a draft', async () => {
    const response = await asAuthor('POST', '/api/posts', {
      body: { body: '<p>Later</p>', published: false },
    });

    assert.equal(response.body.published, false);
  });

  it('is not there at all without a session', async () => {
    const response = await asReader('POST', '/api/posts', { body: { body: '<p>Sneaky</p>' } });

    assert.equal(response.status, 404);
    assert.equal(await Post.countDocuments(), 0);
  });
});

describe('PATCH /api/posts/:id', () => {
  it('edits the body', async () => {
    const post = await seedPost();

    const response = await asAuthor('PATCH', `/api/posts/${post.id}`, {
      body: { body: '<p>Revised</p>' },
    });

    assert.equal(response.body.body, '<p>Revised</p>');
  });

  it('pins and unpins', async () => {
    const post = await seedPost();

    assert.equal(
      (await asAuthor('PATCH', `/api/posts/${post.id}`, { body: { pinned: true } })).body.pinned,
      true,
    );
    assert.equal(
      (await asAuthor('PATCH', `/api/posts/${post.id}`, { body: { pinned: false } })).body.pinned,
      false,
    );
  });

  it('404s for a post that is not there', async () => {
    const response = await asAuthor('PATCH', '/api/posts/507f1f77bcf86cd799439011', {
      body: { pinned: true },
    });
    assert.equal(response.status, 404);
  });

  it('is not there at all without a session', async () => {
    const post = await seedPost();
    const response = await asReader('PATCH', `/api/posts/${post.id}`, {
      body: { body: '<p>Defaced</p>' },
    });

    assert.equal(response.status, 404);
  });
});

describe('DELETE /api/posts/:id', () => {
  it('removes the post and the reactions that pointed at it', async () => {
    const post = await seedPost();
    await asReader('POST', `/api/posts/${post.id}/reactions`, { body: { emote: 'heart' } });

    assert.equal((await asAuthor('DELETE', `/api/posts/${post.id}`)).status, 204);
    assert.equal(await Post.countDocuments(), 0);
    assert.equal(await Reaction.countDocuments(), 0, 'orphaned reactions would accumulate');
  });

  it('404s for a post that is not there', async () => {
    const response = await asAuthor('DELETE', '/api/posts/507f1f77bcf86cd799439011');
    assert.equal(response.status, 404);
  });

  it('is not there at all without a session', async () => {
    const post = await seedPost();
    assert.equal((await asReader('DELETE', `/api/posts/${post.id}`)).status, 404);
    assert.equal(await Post.countDocuments(), 1);
  });
});
