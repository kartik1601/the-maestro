import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ms from '../../src/lib/ms.js';

describe('ms', () => {
  it('parses every unit jsonwebtoken accepts', () => {
    assert.equal(ms('500ms'), 500);
    assert.equal(ms('30s'), 30_000);
    assert.equal(ms('15m'), 900_000);
    assert.equal(ms('3h'), 10_800_000);
    assert.equal(ms('7d'), 604_800_000);
    assert.equal(ms('2w'), 1_209_600_000);
  });

  it('treats a bare number as seconds, matching jsonwebtoken', () => {
    assert.equal(ms('900'), 900_000);
  });

  it('passes a number straight through as milliseconds', () => {
    assert.equal(ms(1234), 1234);
  });

  it('accepts a fraction', () => {
    assert.equal(ms('1.5h'), 5_400_000);
  });

  it('ignores surrounding whitespace and unit case', () => {
    assert.equal(ms('  7D  '), 604_800_000);
  });

  it('refuses a duration it cannot parse rather than guessing', () => {
    assert.throws(() => ms('soon'), /Unrecognized duration/);
    assert.throws(() => ms('7 years'), /Unrecognized duration/);
    assert.throws(() => ms(''), /Unrecognized duration/);
  });

  it('agrees with the default token lifetimes the app ships with', () => {
    // The refresh cookie's maxAge is derived from the same string as the token's
    // expiry; these drifting apart is the bug this function exists to prevent.
    assert.equal(ms('3h'), 3 * 60 * 60 * 1000);
    assert.equal(ms('7d'), 7 * 24 * 60 * 60 * 1000);
  });
});
