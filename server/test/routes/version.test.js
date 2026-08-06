import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Page } from '../../src/models/page.js';
import { Post } from '../../src/models/post.js';
import { Work } from '../../src/models/work.js';
import {
  clearDatabase,
  request,
  startDatabase,
  startServer,
  stopDatabase,
  stopServer,
} from '../helpers/harness.js';

let baseUrl;

const version = () => request(baseUrl, 'GET', '/api/version');

before(async () => {
  await startDatabase();
  baseUrl = await startServer();
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
    assert.equal(response.body.works, null);
    assert.deepEqual(response.body.pages, {});
  });

  it('is never cached, or the whole point is lost', async () => {
    assert.equal((await version()).headers.get('cache-control'), 'no-store');
  });

  it('reports the newest timestamp in each collection', async () => {
    await Post.create({ body: '<p>A post</p>', published: true });
    await Work.create({ section: 'poems', kind: 'document', title: 'A', slug: 'a' });

    const { body } = await version();
    assert.ok(body.posts);
    assert.ok(body.works);
  });

  it('keys pages by slug, so an edit to Novels does not prompt a Poems reader', async () => {
    await Page.create({ slug: 'poems', title: 'Poems' });
    await Page.create({ slug: 'novels', title: 'Novels' });

    const { body } = await version();
    assert.deepEqual(Object.keys(body.pages).sort(), ['novels', 'poems']);
  });

  it('moves on when a work is saved', async () => {
    const work = await Work.create({
      section: 'poems',
      kind: 'document',
      title: 'A',
      slug: 'a',
    });
    const before = (await version()).body.works;

    // Mongo timestamps have millisecond resolution; without this the two saves can
    // land inside the same millisecond and the test would assert nothing.
    await new Promise((resolve) => setTimeout(resolve, 5));
    work.title = 'A, revised';
    await work.save();

    assert.notEqual((await version()).body.works, before);
  });

  it('leaves the other collections alone when one changes', async () => {
    await Post.create({ body: '<p>A post</p>', published: true });
    const first = await version();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await Work.create({ section: 'poems', kind: 'document', title: 'A', slug: 'a' });

    const second = await version();
    assert.equal(second.body.posts, first.body.posts);
    assert.notEqual(second.body.works, first.body.works);
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
