import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

/**
 * scrypt via Node's built-in crypto — no native module to compile, no install-time
 * toolchain, and memory-hard in a way plain PBKDF2 is not. Parameters follow the
 * interactive-login profile from RFC 9106's spirit: ~64 MB of memory per hash.
 */
const PARAMS = { N: 2 ** 16, r: 8, p: 1, keylen: 64 };
const MAX_MEMORY = 256 * 1024 * 1024;

/** Encodes as `scrypt$N$r$p$salt$hash` so parameters can change without breaking old hashes. */
export async function hashSecret(plain) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(normalize(plain), salt, PARAMS.keylen, {
    ...PARAMS,
    maxmem: MAX_MEMORY,
  });
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifySecret(plain, stored) {
  if (typeof stored !== 'string') return false;

  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt') return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');

  const derived = await scrypt(normalize(plain), salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAX_MEMORY,
  });

  return crypto.timingSafeEqual(derived, expected);
}

/** Refresh tokens are high-entropy already, so a plain digest is enough — and fast. */
export const digest = (value) =>
  crypto.createHash('sha256').update(normalize(value)).digest('hex');

/**
 * NFKC guards against a credential that looks identical but carries different code
 * points, which would otherwise silently fail to verify.
 */
const normalize = (value) => String(value ?? '').normalize('NFKC');
