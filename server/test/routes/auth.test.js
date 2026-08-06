import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { Admin } from '../../src/models/admin.js';
import { provisionAdmin } from '../../src/services/auth-service.js';
import {
  clearDatabase,
  cookieAttributes,
  request,
  startDatabase,
  startServer,
  stopDatabase,
  stopServer,
} from '../helpers/harness.js';
import { CREDENTIALS, PORTAL } from '../helpers/fixtures.js';

let baseUrl;

/**
 * A fresh client address per call. The login limiter allows ten attempts per ten
 * minutes and its store outlives every test in this file; without this the tests
 * that come last would be rejected by the limiter rather than by the credentials.
 */
let nextIp = 0;
const freshIp = () => `10.1.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`;

const login = (body, options = {}) =>
  request(baseUrl, 'POST', `${PORTAL}/login`, { body, ip: freshIp(), ...options });

before(async () => {
  await startDatabase();
  baseUrl = await startServer();
});

after(async () => {
  await stopServer();
  await stopDatabase();
});

beforeEach(clearDatabase);

describe('POST /login', () => {
  it('accepts all three correct factors', async () => {
    await provisionAdmin({ ...CREDENTIALS, displayName: 'The Author' });

    const response = await login(CREDENTIALS);

    assert.equal(response.status, 200);
    assert.ok(response.body.accessToken);
    assert.equal(response.body.admin.displayName, 'The Author');
  });

  it('issues an access token carrying the admin role', async () => {
    await provisionAdmin({ ...CREDENTIALS });
    const { body } = await login(CREDENTIALS);

    const claims = jwt.verify(body.accessToken, process.env.JWT_ACCESS_SECRET, {
      issuer: 'the-maestro',
      audience: 'the-maestro-admin',
    });
    assert.equal(claims.role, 'admin');
  });

  it('sets the refresh token as an httpOnly cookie scoped to the portal', async () => {
    await provisionAdmin({ ...CREDENTIALS });
    const response = await login(CREDENTIALS);

    const cookie = cookieAttributes(response, 'maestro_rt');
    assert.ok(cookie, 'expected a maestro_rt cookie');
    assert.equal(cookie.attributes.httponly, true);
    assert.equal(cookie.attributes.path, PORTAL);
    assert.equal(cookie.attributes.samesite, 'Lax');
  });

  it('never returns the refresh token in the body', async () => {
    await provisionAdmin({ ...CREDENTIALS });
    const { body } = await login(CREDENTIALS);
    assert.equal(body.refreshToken, undefined);
  });

  it('refuses a wrong password', async () => {
    await provisionAdmin({ ...CREDENTIALS });
    const response = await login({ ...CREDENTIALS, password: 'wrong' });

    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Invalid credentials');
  });

  it('refuses a wrong username', async () => {
    await provisionAdmin({ ...CREDENTIALS });
    const response = await login({ ...CREDENTIALS, username: 'somebody-else' });
    assert.equal(response.status, 401);
  });

  it('refuses a wrong auth key — two right factors are not enough', async () => {
    await provisionAdmin({ ...CREDENTIALS });
    const response = await login({ ...CREDENTIALS, authKey: 'wrong' });
    assert.equal(response.status, 401);
  });

  it('refuses a missing factor with the same answer as a wrong one', async () => {
    await provisionAdmin({ ...CREDENTIALS });

    const missing = await login({ username: CREDENTIALS.username, password: CREDENTIALS.password });
    const wrong = await login({ ...CREDENTIALS, authKey: 'wrong' });

    assert.equal(missing.status, 401);
    assert.deepEqual(missing.body, wrong.body);
  });

  it('says the same thing when no admin has been provisioned at all', async () => {
    const response = await login(CREDENTIALS);
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Invalid credentials');
  });

  it('locks the account after five failures, and then refuses the right credentials', async () => {
    await provisionAdmin({ ...CREDENTIALS });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login({ ...CREDENTIALS, password: 'wrong' });
      assert.equal(response.status, 401);
    }

    const locked = await login(CREDENTIALS);
    assert.equal(locked.status, 401, 'a locked account refuses even the right credentials');

    const admin = await Admin.findOne({ singleton: 'admin' });
    assert.ok(admin.isLocked());
  });

  it('resets the failure count on a successful sign-in', async () => {
    await provisionAdmin({ ...CREDENTIALS });

    await login({ ...CREDENTIALS, password: 'wrong' });
    await login({ ...CREDENTIALS, password: 'wrong' });
    await login(CREDENTIALS);

    const admin = await Admin.findOne({ singleton: 'admin' });
    assert.equal(admin.failedAttempts, 0);
    assert.equal(admin.lockedUntil, null);
    assert.ok(admin.lastLoginAt);
  });
});

describe('POST /refresh', () => {
  it('exchanges the cookie for a new access token', async () => {
    await provisionAdmin({ ...CREDENTIALS });
    const first = await login(CREDENTIALS);

    const refreshed = await request(baseUrl, 'POST', `${PORTAL}/refresh`, {
      cookies: first.cookies,
    });

    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.accessToken);
    assert.equal(refreshed.body.admin.displayName, 'The Author');
  });

  it('rotates the cookie, so the presented token is consumed', async () => {
    await provisionAdmin({ ...CREDENTIALS });
    const first = await login(CREDENTIALS);

    const refreshed = await request(baseUrl, 'POST', `${PORTAL}/refresh`, {
      cookies: first.cookies,
    });

    assert.notEqual(refreshed.cookies, first.cookies);
  });

  it('refuses a request with no cookie', async () => {
    const response = await request(baseUrl, 'POST', `${PORTAL}/refresh`);
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Invalid session');
  });

  it('refuses a token it did not sign', async () => {
    const forged = jwt.sign({ sub: 'x', jti: 'y' }, 'not-the-secret', {
      issuer: 'the-maestro',
      audience: 'the-maestro-admin',
      expiresIn: '7d',
    });

    const response = await request(baseUrl, 'POST', `${PORTAL}/refresh`, {
      cookies: `maestro_rt=${forged}`,
    });
    assert.equal(response.status, 401);
  });

  it('drops every session when a consumed token is presented again', async () => {
    await provisionAdmin({ ...CREDENTIALS });
    const first = await login(CREDENTIALS);

    // A second device, so there is something else to lose.
    const second = await login(CREDENTIALS);

    await request(baseUrl, 'POST', `${PORTAL}/refresh`, { cookies: first.cookies });

    // The leaked token, replayed.
    const replayed = await request(baseUrl, 'POST', `${PORTAL}/refresh`, {
      cookies: first.cookies,
    });
    assert.equal(replayed.status, 401);

    const other = await request(baseUrl, 'POST', `${PORTAL}/refresh`, {
      cookies: second.cookies,
    });
    assert.equal(other.status, 401, 'reuse invalidates every session, not just this one');

    const admin = await Admin.findOne({ singleton: 'admin' });
    assert.equal(admin.refreshTokens.length, 0);
  });

  it('keeps other sessions alive through an ordinary rotation', async () => {
    await provisionAdmin({ ...CREDENTIALS });
    const laptop = await login(CREDENTIALS);
    const phone = await login(CREDENTIALS);

    await request(baseUrl, 'POST', `${PORTAL}/refresh`, { cookies: laptop.cookies });

    const stillGood = await request(baseUrl, 'POST', `${PORTAL}/refresh`, {
      cookies: phone.cookies,
    });
    assert.equal(stillGood.status, 200);
  });
});

describe('POST /logout', () => {
  it('revokes the session and clears the cookie', async () => {
    await provisionAdmin({ ...CREDENTIALS });
    const session = await login(CREDENTIALS);

    const response = await request(baseUrl, 'POST', `${PORTAL}/logout`, {
      cookies: session.cookies,
    });
    assert.equal(response.status, 204);

    const refreshed = await request(baseUrl, 'POST', `${PORTAL}/refresh`, {
      cookies: session.cookies,
    });
    assert.equal(refreshed.status, 401);
  });

  it('succeeds even with no session to end', async () => {
    const response = await request(baseUrl, 'POST', `${PORTAL}/logout`);
    assert.equal(response.status, 204);
  });

  it('leaves other sessions signed in', async () => {
    await provisionAdmin({ ...CREDENTIALS });
    const laptop = await login(CREDENTIALS);
    const phone = await login(CREDENTIALS);

    await request(baseUrl, 'POST', `${PORTAL}/logout`, { cookies: laptop.cookies });

    const stillGood = await request(baseUrl, 'POST', `${PORTAL}/refresh`, {
      cookies: phone.cookies,
    });
    assert.equal(stillGood.status, 200);
  });
});

describe('GET /me', () => {
  it('names the signed-in author', async () => {
    await provisionAdmin({ ...CREDENTIALS, displayName: 'Kartik' });
    const { body } = await login(CREDENTIALS);

    const response = await request(baseUrl, 'GET', `${PORTAL}/me`, {
      token: body.accessToken,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.displayName, 'Kartik');
    assert.equal(response.body.role, 'admin');
  });

  it('answers 404 without a token, so the route is not discoverable', async () => {
    const response = await request(baseUrl, 'GET', `${PORTAL}/me`);
    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'Not found');
  });

  it('answers 404 for a token it did not sign', async () => {
    const forged = jwt.sign({ sub: 'x', role: 'admin' }, 'not-the-secret', {
      issuer: 'the-maestro',
      audience: 'the-maestro-admin',
      expiresIn: '1h',
    });

    const response = await request(baseUrl, 'GET', `${PORTAL}/me`, { token: forged });
    assert.equal(response.status, 404);
  });

  it('answers 401 TOKEN_EXPIRED for a lapsed token, so the client knows to refresh', async () => {
    const expired = jwt.sign({ sub: 'x', role: 'admin' }, process.env.JWT_ACCESS_SECRET, {
      issuer: 'the-maestro',
      audience: 'the-maestro-admin',
      expiresIn: '-1s',
    });

    const response = await request(baseUrl, 'GET', `${PORTAL}/me`, { token: expired });
    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'TOKEN_EXPIRED');
  });
});

describe('the portal path', () => {
  it('is the only place the auth API answers from', async () => {
    const response = await request(baseUrl, 'POST', '/api/auth/login', { body: CREDENTIALS });
    assert.equal(response.status, 404);
  });
});
