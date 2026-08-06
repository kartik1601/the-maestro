import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { digest, hashSecret, verifySecret } from '../../src/config/hash.js';

describe('hashSecret / verifySecret', () => {
  it('verifies the secret it hashed', async () => {
    const stored = await hashSecret('a-passphrase');
    assert.equal(await verifySecret('a-passphrase', stored), true);
  });

  it('refuses anything else', async () => {
    const stored = await hashSecret('a-passphrase');
    assert.equal(await verifySecret('a-passphras', stored), false);
    assert.equal(await verifySecret('A-Passphrase', stored), false);
    assert.equal(await verifySecret('', stored), false);
  });

  it('salts, so the same secret never hashes to the same string twice', async () => {
    const [first, second] = await Promise.all([hashSecret('same'), hashSecret('same')]);
    assert.notEqual(first, second);
    assert.equal(await verifySecret('same', first), true);
    assert.equal(await verifySecret('same', second), true);
  });

  it('records its parameters, so they can change without breaking old hashes', async () => {
    const [scheme, n, r, p, salt, hash] = (await hashSecret('x')).split('$');
    assert.equal(scheme, 'scrypt');
    assert.equal(Number(n), 2 ** 16);
    assert.equal(Number(r), 8);
    assert.equal(Number(p), 1);
    assert.ok(salt.length > 0);
    assert.ok(hash.length > 0);
  });

  it('normalizes, so a visually identical credential still verifies', async () => {
    // U+00E9 and e + U+0301 look the same and would otherwise never match.
    const stored = await hashSecret('café');
    assert.equal(await verifySecret('café', stored), true);
  });

  it('refuses a stored value that is not a hash of ours', async () => {
    assert.equal(await verifySecret('x', 'bcrypt$whatever'), false);
    assert.equal(await verifySecret('x', ''), false);
    assert.equal(await verifySecret('x', null), false);
    assert.equal(await verifySecret('x', undefined), false);
  });
});

describe('digest', () => {
  it('is stable for the same input', () => {
    assert.equal(digest('a-refresh-token'), digest('a-refresh-token'));
  });

  it('differs for different input', () => {
    assert.notEqual(digest('one'), digest('two'));
  });

  it('is a sha-256 hex string', () => {
    assert.match(digest('x'), /^[a-f0-9]{64}$/);
  });

  it('normalizes the same way hashing does', () => {
    assert.equal(digest('café'), digest('café'));
  });

  it('survives nothing at all', () => {
    assert.equal(digest(null), digest(''));
    assert.equal(digest(undefined), digest(''));
  });
});
