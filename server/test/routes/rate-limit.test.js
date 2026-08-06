import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  clearDatabase,
  request,
  startDatabase,
  startServer,
  stopDatabase,
  stopServer,
} from '../helpers/harness.js';
import { CREDENTIALS, PORTAL } from '../helpers/fixtures.js';
import { provisionAdmin } from '../../src/services/auth-service.js';

/**
 * In a file of its own on purpose: the limiter's store is module-level and lives for
 * the whole process, so a suite that exhausts it would throttle anything sharing it.
 * `node --test` gives each file its own process.
 */

let baseUrl;
const CLIENT = '203.0.113.7';

before(async () => {
  await startDatabase();
  await clearDatabase();
  baseUrl = await startServer();
  await provisionAdmin({ ...CREDENTIALS });
});

after(async () => {
  await stopServer();
  await stopDatabase();
});

describe('the login limiter', () => {
  it('refuses further attempts from one address after ten, and says only "Not found"', async () => {
    const attempt = () =>
      request(baseUrl, 'POST', `${PORTAL}/login`, {
        body: { ...CREDENTIALS, password: 'wrong' },
        ip: CLIENT,
      });

    for (let n = 0; n < 10; n += 1) {
      assert.equal((await attempt()).status, 401, `attempt ${n + 1} should still be answered`);
    }

    const throttled = await attempt();
    assert.equal(throttled.status, 429);
    assert.equal(
      throttled.body.error,
      'Not found',
      'a throttled attacker learns nothing about what is behind this path',
    );
  });

  it('does not throttle a different address', async () => {
    const response = await request(baseUrl, 'POST', `${PORTAL}/login`, {
      body: { ...CREDENTIALS, password: 'wrong' },
      ip: '203.0.113.8',
    });

    assert.equal(response.status, 401);
  });

  it('does not throttle ordinary reading', async () => {
    for (let n = 0; n < 20; n += 1) {
      assert.equal((await request(baseUrl, 'GET', '/api/version', { ip: CLIENT })).status, 200);
    }
  });
});
