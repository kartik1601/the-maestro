import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Visit } from '../../src/models/visit.js';
import { Work } from '../../src/models/work.js';
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

const PULSE = `/api/${process.env.ADMIN_PORTAL_PATH}/pulse`;
const READER = 'r-11112222-aaaa';
const OTHER = 'r-33334444-bbbb';

const open = (body, options = {}) =>
  request(baseUrl, 'POST', '/api/visits', { body, reactorId: READER, ...options });
const pulse = (query = '') => request(baseUrl, 'GET', `${PULSE}${query}`, { token });

before(async () => {
  await startDatabase();
  baseUrl = await startServer();
});

after(async () => {
  await stopServer();
  await stopDatabase();
});

beforeEach(async () => {
  await clearDatabase();
  // The admin lives in the database too, so the session is re-made with it.
  ({ token } = await signIn(baseUrl));
  await Work.create({
    section: 'poems',
    kind: 'document',
    title: 'The First Second',
    slug: 'the-first-second',
    published: true,
  });
});

describe('POST /api/visits', () => {
  it('records a visit and names the page from the database, not the request', async () => {
    const response = await open({ path: '/poems/the-first-second', title: 'Something else' });

    assert.equal(response.status, 201);
    const visit = await Visit.findById(response.body.id).lean();
    assert.equal(visit.title, 'The First Second');
    assert.equal(visit.section, 'poems');
  });

  it('counts the home page and a shelf', async () => {
    assert.equal((await open({ path: '/' })).status, 201);
    assert.equal((await open({ path: '/novels' })).status, 201);
    assert.equal(await Visit.countDocuments(), 2);
  });

  it('ignores a path that names nothing a reader can see', async () => {
    await Work.create({ section: 'poems', kind: 'document', title: 'Draft', slug: 'draft' });

    for (const path of ['/nowhere', '/poems/missing', '/poems/draft', '/test-portal']) {
      assert.equal((await open({ path })).status, 204, path);
    }
    assert.equal(await Visit.countDocuments(), 0);
  });

  it('never counts the author', async () => {
    assert.equal((await open({ path: '/' }, { token })).status, 204);
    assert.equal(await Visit.countDocuments(), 0);
  });

  it('needs the anonymous id, and stores nothing else about the reader', async () => {
    assert.equal((await open({ path: '/' }, { reactorId: '' })).status, 204);

    const { body } = await open({ path: '/' });
    const visit = await Visit.findById(body.id).lean();
    assert.deepEqual(
      Object.keys(visit).sort(),
      ['_id', 'landing', 'page', 'pages', 'path', 'section', 'seenAt', 'source', 'startedAt', 'tabId', 'title', 'via', 'visitorId'],
    );
  });

  it('strips anything but letters, digits and dashes from the tag', async () => {
    const { body } = await open({ path: '/', via: '<b>Story-9oct</b>' });
    assert.equal((await Visit.findById(body.id).lean()).via, 'bstory-9octb');
  });
});

describe('POST /api/visits/:id/beat', () => {
  it('keeps the visit alive and records the page being read', async () => {
    const { body } = await open({ path: '/' });
    const before = (await Visit.findById(body.id).lean()).seenAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const response = await request(baseUrl, 'POST', `/api/visits/${body.id}/beat`, {
      body: { page: 42, pages: 318 },
      reactorId: READER,
    });

    assert.equal(response.status, 204);
    const visit = await Visit.findById(body.id).lean();
    assert.ok(visit.seenAt > before);
    assert.equal(visit.page, 42);
    assert.equal(visit.pages, 318);
  });

  it('cannot be used to keep somebody else’s visit alive', async () => {
    const { body } = await open({ path: '/' });
    const before = (await Visit.findById(body.id).lean()).seenAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await request(baseUrl, 'POST', `/api/visits/${body.id}/beat`, { body: {}, reactorId: OTHER });

    assert.deepEqual((await Visit.findById(body.id).lean()).seenAt, before);
  });
});

describe('GET pulse', () => {
  it('does not exist for anyone but the author', async () => {
    const response = await request(baseUrl, 'GET', PULSE);
    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'Not found');
  });

  it('lists who is reading now, once per tab, where they currently are', async () => {
    await open({ path: '/', tab: 'tab-1' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await open({ path: '/poems/the-first-second', tab: 'tab-1' });
    await open({ path: '/novels', tab: 'tab-2' }, { reactorId: OTHER });

    const { body } = await pulse();
    assert.equal(body.live.length, 2);

    const first = body.live.find((row) => row.reader === 'r-1111');
    assert.equal(first.title, 'The First Second');
    assert.equal(first.place, 'Poems');
    assert.equal(body.places.find((place) => place.key === 'poems').count, 1);
    assert.equal(body.places.find((place) => place.key === 'home').count, 0);
  });

  it('drops a reader who has stopped beating', async () => {
    const { body: visit } = await open({ path: '/' });
    await Visit.updateOne({ _id: visit.id }, { seenAt: new Date(Date.now() - 60_000) });

    const { body } = await pulse();
    assert.equal(body.live.length, 0);
    assert.equal(body.totals.views, 1, 'still a view, just not a live one');
  });

  it('counts views, readers and per-work totals inside the range', async () => {
    await open({ path: '/poems/the-first-second' });
    await open({ path: '/poems/the-first-second' }, { reactorId: OTHER });
    const { body: old } = await open({ path: '/poems/the-first-second' });
    const longAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    await Visit.updateOne({ _id: old.id }, { startedAt: longAgo, seenAt: longAgo });

    const { body } = await pulse('?range=7d&tz=Asia/Kolkata');
    assert.equal(body.totals.views, 2);
    assert.equal(body.totals.readers, 2);
    assert.equal(body.totals.today, 2);
    assert.equal(body.totals.allTime, 3);

    assert.equal(body.top.length, 1);
    assert.equal(body.top[0].views, 2);
    assert.equal(body.top[0].allTime, 3);

    assert.equal(body.days.length, 14);
    assert.equal(body.days.at(-1).views, 2);
    assert.equal((await pulse('?range=all')).body.totals.views, 3);
  });

  it('survives a timezone that is not one', async () => {
    assert.equal((await pulse('?tz=Not/AZone')).status, 200);
  });
});

describe('tagged links', () => {
  const makeLink = (body) => request(baseUrl, 'POST', `${PULSE}/links`, { body, token });

  it('makes a tag from the name, and a different one for the same name twice', async () => {
    const first = await makeLink({ label: 'Story, 9 Oct', path: '/poems/the-first-second' });
    const second = await makeLink({ label: 'Story, 9 Oct' });

    assert.equal(first.status, 201);
    assert.equal(first.body.tag, 'story-9-oct');
    assert.equal(first.body.path, '/poems/the-first-second');
    assert.equal(second.body.tag, 'story-9-oct-2');
    assert.equal(second.body.path, '/');
  });

  it('counts an open once per arrival, not once per page turned', async () => {
    await makeLink({ label: 'Bio' });
    await open({ path: '/', via: 'bio', landing: true, source: 'instagram' });
    await open({ path: '/novels', via: 'bio', landing: false, source: 'instagram' });

    const { body } = await pulse();
    const bio = body.links.find((link) => link.tag === 'bio');
    assert.equal(bio.opens, 1);
    assert.ok(bio.lastOpenedAt);
    assert.equal(body.totals.instagram, 1);
    assert.equal(body.live[0].from, 'Instagram · Bio');
  });

  it('files a plain Instagram tap under untagged', async () => {
    await open({ path: '/', landing: true, source: 'instagram' });
    await open({ path: '/', landing: true, source: 'google' }, { reactorId: OTHER });

    const { body } = await pulse();
    assert.deepEqual(
      body.links.map((link) => [link.label, link.opens]),
      [['Instagram, untagged', 1]],
    );
    assert.equal(body.totals.arrivals, 2);
    assert.equal(body.totals.instagram, 1);
  });

  it('can be removed without losing what it counted', async () => {
    const { body: link } = await makeLink({ label: 'Bio' });
    await open({ path: '/', via: 'bio', landing: true });

    const removed = await request(baseUrl, 'DELETE', `${PULSE}/links/${link.id}`, { token });
    assert.equal(removed.status, 204);
    assert.equal((await pulse()).body.totals.instagram, 1);
  });

  it('is closed to everyone else', async () => {
    const response = await request(baseUrl, 'POST', `${PULSE}/links`, { body: { label: 'Bio' } });
    assert.equal(response.status, 404);
  });
});
