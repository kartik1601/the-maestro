import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  clearDatabase,
  request,
  startDatabase,
  startServer,
  stopDatabase,
  stopServer,
} from '../helpers/harness.js';
import { setLetter, guardKey, COOLDOWN_MS } from '../../src/services/letter-service.js';
import { setMailTransport } from '../../src/services/mailer.js';
import { Letter, LetterEvent, LetterGuard } from '../../src/models/letter.js';
import { signIn } from '../helpers/fixtures.js';
import { storeVideo } from '../../src/services/letter-video.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Stand-ins. The real answers are never in the repository. */
const ANSWERS = {
  name: 'Ada Lovelace',
  privateHandle: 'ada__1815',
  publicHandle: 'countess_ada',
  dob: '1815-12-10',
};
const GREETINGS = ['Ada', 'Addie', 'Ada-aaah'];
const WRONG = { ...ANSWERS, dob: '1815-12-11' };

let baseUrl;
let mail = [];
let ipCount = 0;
const freshIp = () => `198.51.100.${++ipCount}`;

const status = (ip) => request(baseUrl, 'GET', '/api/letter/status', { ip });
const unlock = (ip, body) => request(baseUrl, 'POST', '/api/letter/unlock', { ip, body });
const otp = (ip, code) => request(baseUrl, 'POST', '/api/letter/otp', { ip, body: { code } });
const askCode = (ip, email = 'reader@gmail.com') =>
  request(baseUrl, 'POST', '/api/letter/request-otp', { ip, body: { email } });
/** A wrong answer, then a code asked for — what the old flow did in one step. */
const missAndAsk = async (ip) => {
  await unlock(ip, WRONG);
  return askCode(ip);
};
const lastCode = () => mail.at(-1).text.match(/Bypass code: (\d{6})/)[1];

before(async () => {
  await startDatabase();
  baseUrl = await startServer();
  setMailTransport(async (message) => mail.push(message));
});

after(async () => {
  setMailTransport(null);
  await stopServer();
  await stopDatabase();
});

beforeEach(async () => {
  await clearDatabase();
  mail = [];
  await setLetter({ answers: ANSWERS, greetings: GREETINGS });
});

describe('the letter gate', () => {
  it('is off when no letter has been set', async () => {
    await Letter.deleteMany({});
    assert.equal((await status(freshIp())).body.state, 'off');
  });

  it('stores one hash and nothing she typed', async () => {
    const stored = JSON.stringify(await Letter.findOne().lean());
    for (const value of Object.values(ANSWERS)) {
      assert.ok(!stored.toLowerCase().includes(value.toLowerCase()), `${value} leaked`);
    }
  });

  it('opens for the right answers, ignoring case, spacing and a leading @', async () => {
    const ip = freshIp();
    const response = await unlock(ip, {
      name: '  ada   LOVELACE ',
      privateHandle: '@ADA__1815',
      publicHandle: 'Countess_Ada',
      dob: '1815-12-10',
    });

    assert.equal(response.body.state, 'unlocked');
    assert.ok(response.body.token);

    const content = await request(baseUrl, 'GET', '/api/letter/content', {
      ip,
      headers: { 'x-letter-token': response.body.token },
    });
    assert.equal(content.status, 200);
    assert.deepEqual(content.body.greetings, GREETINGS);
  });

  it('keeps the content behind a valid token', async () => {
    const none = await request(baseUrl, 'GET', '/api/letter/content', { ip: freshIp() });
    const forged = await request(baseUrl, 'GET', '/api/letter/content', {
      ip: freshIp(),
      headers: { 'x-letter-token': 'not.a.token' },
    });
    assert.equal(none.status, 404);
    assert.equal(forged.status, 404);
  });

  it('turns a wrong answer into a strike and a wait, and mails nobody yet', async () => {
    const ip = freshIp();
    const response = await unlock(ip, WRONG);

    assert.equal(response.body.state, 'email');
    assert.equal(response.body.triesLeft, 2);
    assert.equal(mail.length, 0);

    // Even the right answers wait out the fifteen minutes.
    assert.equal((await unlock(ip, ANSWERS)).body.state, 'email');
  });

  it('mails the author the reader\'s Gmail with a code, once per strike', async () => {
    const ip = freshIp();
    await unlock(ip, WRONG);

    const asked = await askCode(ip, '  Reader@Gmail.com ');
    assert.equal(asked.body.state, 'otp');
    assert.equal(asked.body.otpTriesLeft, 3);
    assert.equal(mail.length, 1);
    assert.equal(mail[0].to, 'author@example.test');
    assert.match(mail[0].text, /reader@gmail\.com/);
    assert.match(mail[0].text, /Bypass code: \d{6}/);
    assert.match(mail[0].text, new RegExp(`IP: ${ip.replaceAll('.', '\\.')}`));

    // Asking again does not mail again.
    assert.equal((await askCode(ip)).body.state, 'otp');
    assert.equal(mail.length, 1);
  });

  it('refuses an address that is not an email, without spending the request', async () => {
    const ip = freshIp();
    await unlock(ip, WRONG);

    const bad = await askCode(ip, 'not an email');
    assert.equal(bad.body.state, 'email');
    assert.equal(bad.body.error, 'email');
    assert.equal(mail.length, 0);
    assert.equal((await askCode(ip)).body.state, 'otp');
  });

  it('will not send a code to an address that has not missed', async () => {
    const asked = await askCode(freshIp());
    assert.equal(asked.body.state, 'open');
    assert.equal(mail.length, 0);
  });

  it('lifts the wait with the right code, but keeps the strike', async () => {
    const ip = freshIp();
    await missAndAsk(ip);

    const lifted = await otp(ip, lastCode());
    assert.equal(lifted.body.state, 'open');
    assert.equal(lifted.body.triesLeft, 2);

    assert.equal((await unlock(ip, ANSWERS)).body.state, 'unlocked');
  });

  it('spends the code after three wrong tries and leaves the wait to run out', async () => {
    const ip = freshIp();
    await missAndAsk(ip);
    const code = lastCode();
    const wrongCode = code === '000000' ? '000001' : '000000';

    assert.equal((await otp(ip, wrongCode)).body.otpTriesLeft, 2);
    assert.equal((await otp(ip, wrongCode)).body.otpTriesLeft, 1);

    const spent = await otp(ip, wrongCode);
    assert.equal(spent.body.state, 'cooldown');
    assert.ok(new Date(spent.body.retryAt) > new Date());

    // The real code no longer works, and no second code can be asked for.
    assert.equal((await otp(ip, code)).body.state, 'cooldown');
    assert.equal((await askCode(ip)).body.state, 'cooldown');
  });

  it('blocks the address for a day on the third wrong answer', async () => {
    const ip = freshIp();

    for (let strike = 1; strike <= 2; strike += 1) {
      await missAndAsk(ip);
      assert.equal((await otp(ip, lastCode())).body.state, 'open');
    }

    const third = await unlock(ip, WRONG);
    assert.equal(third.body.state, 'blocked');
    const hours = (new Date(third.body.retryAt) - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24, `blocked for ${hours}h`);
    assert.match(mail.at(-1).text, /blocked/);
    assert.match(mail.at(-1).text, /reader@gmail\.com/);

    assert.equal((await status(ip)).body.state, 'blocked');
    assert.equal((await unlock(ip, ANSWERS)).body.state, 'blocked');
  });

  it('judges each address on its own', async () => {
    const one = freshIp();
    await unlock(one, WRONG);
    assert.equal((await status(freshIp())).body.state, 'open');
  });

  it('opens again once the wait has passed', async () => {
    const ip = freshIp();
    await unlock(ip, WRONG);
    await LetterGuard.updateOne(
      { key: guardKey(ip) },
      { $set: { cooldownUntil: new Date(Date.now() - 1) } },
    );

    const state = await status(ip);
    assert.equal(state.body.state, 'open');
    assert.equal(state.body.triesLeft, 2);
    assert.ok(COOLDOWN_MS === 15 * 60 * 1000);
  });

  it('judges only one of two answers sent at the same moment', async () => {
    const ip = freshIp();
    const results = await Promise.all([unlock(ip, WRONG), unlock(ip, WRONG)]);

    const guard = await LetterGuard.findOne({ key: guardKey(ip) }).lean();
    assert.equal(guard.strikes, 1);
    // The loser may read the guard before the winner's code is written; either way it
    // was refused, not judged.
    const states = results.map((r) => r.body.state);
    assert.ok(states.includes('email'));
    assert.ok(states.every((state) => state === 'email' || state === 'cooldown'));
    assert.equal(await LetterEvent.countDocuments({ kind: 'wrong' }), 1);
  });
});

describe('the letter\'s video', () => {
  const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  const openUp = async () => {
    const ip = freshIp();
    const { body } = await unlock(ip, ANSWERS);
    const content = await request(baseUrl, 'GET', '/api/letter/content', {
      ip,
      headers: { 'x-letter-token': body.token },
    });
    return { ip, letterToken: body.token, video: content.body.video };
  };
  const fetchVideo = (path, headers = {}) => fetch(`${baseUrl}${path}`, { headers });

  it('is left out of the content until one is stored', async () => {
    assert.equal((await openUp()).video, null);
  });

  it('streams byte ranges to a holder of the video token, and to nobody else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'letter-video-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, BYTES);
    await storeVideo('hd', file);

    const { video, letterToken } = await openUp();
    assert.ok(video?.token);

    const whole = await fetchVideo(`/api/letter/video/hd?t=${video.token}`);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await whole.arrayBuffer()), BYTES);

    const part = await fetchVideo(`/api/letter/video/hd?t=${video.token}`, { range: 'bytes=100-199' });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000');
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), BYTES.subarray(100, 200));

    const tail = await fetchVideo(`/api/letter/video/hd?t=${video.token}`, { range: 'bytes=-10' });
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()), BYTES.subarray(990));

    const beyond = await fetchVideo(`/api/letter/video/hd?t=${video.token}`, { range: 'bytes=5000-' });
    assert.equal(beyond.status, 416);

    assert.equal((await fetchVideo('/api/letter/video/hd')).status, 404);
    assert.equal((await fetchVideo(`/api/letter/video/hd?t=${letterToken}`)).status, 404);
    assert.equal((await fetchVideo(`/api/letter/video/sd?t=${video.token}`)).status, 404);
  });

  it('keeps only the newest cut of each quality', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'letter-video-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, BYTES);
    await storeVideo('sd', file);
    const second = await storeVideo('sd', file);
    assert.equal(second.replaced, 1);
  });
});

describe('the letter on Pulse', () => {
  const PULSE = `/api/${process.env.ADMIN_PORTAL_PATH}/pulse/letter`;

  it('is not there without a session', async () => {
    assert.equal((await request(baseUrl, 'GET', PULSE)).status, 404);
  });

  it('shows who opened it, who missed, and who is held, by IP', async () => {
    const opener = freshIp();
    const misser = freshIp();
    await unlock(opener, ANSWERS);
    await missAndAsk(misser);

    const { token } = await signIn(baseUrl);
    const view = await request(baseUrl, 'GET', PULSE, { token });

    assert.equal(view.status, 200);
    assert.equal(view.body.enabled, true);
    assert.equal(view.body.opened, 1);
    assert.deepEqual(
      view.body.events.map((event) => [event.kind, event.ip]),
      [
        ['otp-requested', misser],
        ['wrong', misser],
        ['unlocked', opener],
      ],
    );
    assert.equal(view.body.held.length, 1);
    assert.equal(view.body.held[0].ip, misser);
    assert.equal(view.body.held[0].email, 'reader@gmail.com');
    assert.equal(view.body.held[0].state, 'otp');
  });

  it('lets the author lift a block, wiping the strikes', async () => {
    const ip = freshIp();
    await LetterGuard.create({
      key: guardKey(ip),
      ip,
      strikes: 3,
      firstStrikeAt: new Date(),
      blockedUntil: new Date(Date.now() + 3_600_000),
      expireAt: new Date(Date.now() + 3_600_000),
    });
    assert.equal((await status(ip)).body.state, 'blocked');

    const { token } = await signIn(baseUrl);
    const [held] = (await request(baseUrl, 'GET', PULSE, { token })).body.held;
    const released = await request(baseUrl, 'DELETE', `${PULSE}/held/${held.id}`, { token });

    assert.equal(released.status, 204);
    const after = await status(ip);
    assert.equal(after.body.state, 'open');
    assert.equal(after.body.triesLeft, 3);
    assert.equal(await LetterEvent.countDocuments({ kind: 'unblocked', ip }), 1);
  });
});
