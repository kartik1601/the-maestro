import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import ms from '../lib/ms.js';
import { env } from '../config/env.js';
import { digest, hashSecret, verifySecret } from '../config/hash.js';
import { Admin } from '../models/admin.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Deliberately uniform failure. Every rejected login — wrong username, wrong
 * password, wrong auth key, no admin provisioned, account locked — produces the
 * same error. An attacker learns only "no", never which of the three factors was
 * the one that failed.
 */
export class AuthError extends Error {
  constructor(reason) {
    super('Invalid credentials');
    this.name = 'AuthError';
    this.reason = reason; // Logged server-side only, never serialized to the client.
  }
}

/**
 * Verifies all three factors against the single admin document.
 *
 * Because the username is stored hashed (per spec), there is nothing to look up by
 * — so we load the one admin that exists and verify each factor. All three are
 * checked even when an earlier one has already failed, so response time does not
 * reveal which factor was wrong.
 */
export async function authenticateAdmin({ username, password, authKey, userAgent }) {
  const admin = await Admin.findOne({ singleton: 'admin' });

  if (!admin) {
    // Burn comparable time so "not provisioned" is indistinguishable from "wrong".
    await verifySecret(password ?? '', await hashSecret(crypto.randomUUID()));
    throw new AuthError('no-admin-provisioned');
  }

  if (admin.isLocked()) {
    throw new AuthError('locked-out');
  }

  const [usernameOk, passwordOk, authKeyOk] = await Promise.all([
    verifySecret(username, admin.usernameHash),
    verifySecret(password, admin.passwordHash),
    verifySecret(authKey, admin.authKeyHash),
  ]);

  if (!usernameOk || !passwordOk || !authKeyOk) {
    admin.failedAttempts += 1;
    if (admin.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      admin.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
      admin.failedAttempts = 0;
    }
    await admin.save();
    throw new AuthError('factor-mismatch');
  }

  admin.failedAttempts = 0;
  admin.lockedUntil = null;
  admin.lastLoginAt = new Date();

  const tokens = await issueTokens(admin, { userAgent });
  await admin.save();

  return { admin, ...tokens };
}

async function issueTokens(admin, { userAgent }) {
  const accessToken = jwt.sign(
    { sub: admin.id, role: 'admin', name: admin.displayName },
    env.jwt.accessSecret,
    {
      expiresIn: env.jwt.accessTtl,
      issuer: env.jwt.issuer,
      audience: env.jwt.audience,
    },
  );

  // The refresh token carries a random jti so a specific session can be revoked
  // without invalidating every other device.
  const jti = crypto.randomBytes(32).toString('hex');
  const refreshToken = jwt.sign({ sub: admin.id, jti }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshTtl,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });

  const expiresAt = new Date(Date.now() + ms(env.jwt.refreshTtl));
  admin.refreshTokens.push({ tokenHash: digest(refreshToken), expiresAt, userAgent });
  pruneExpired(admin);

  return { accessToken, refreshToken, expiresAt };
}

/**
 * Rotation: the presented token is consumed and replaced. Reuse of an already-consumed
 * token means it leaked, so every session is dropped rather than just refusing this one.
 */
export async function rotateRefreshToken(presentedToken, { userAgent } = {}) {
  let payload;
  try {
    payload = jwt.verify(presentedToken, env.jwt.refreshSecret, {
      issuer: env.jwt.issuer,
      audience: env.jwt.audience,
    });
  } catch {
    throw new AuthError('refresh-token-invalid');
  }

  const admin = await Admin.findById(payload.sub);
  if (!admin) throw new AuthError('refresh-admin-missing');

  const presentedHash = digest(presentedToken);
  const index = admin.refreshTokens.findIndex((entry) => entry.tokenHash === presentedHash);

  if (index === -1) {
    admin.refreshTokens = [];
    await admin.save();
    throw new AuthError('refresh-token-reuse');
  }

  admin.refreshTokens.splice(index, 1);
  const tokens = await issueTokens(admin, { userAgent });
  await admin.save();

  return { admin, ...tokens };
}

export async function revokeRefreshToken(presentedToken) {
  if (!presentedToken) return;
  const presentedHash = digest(presentedToken);
  await Admin.updateOne(
    { singleton: 'admin' },
    { $pull: { refreshTokens: { tokenHash: presentedHash } } },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret, {
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}

export async function provisionAdmin({ username, password, authKey, displayName }) {
  const [usernameHash, passwordHash, authKeyHash] = await Promise.all([
    hashSecret(username),
    hashSecret(password),
    hashSecret(authKey),
  ]);

  return Admin.findOneAndUpdate(
    { singleton: 'admin' },
    {
      singleton: 'admin',
      displayName: displayName ?? 'The Author',
      usernameHash,
      passwordHash,
      authKeyHash,
      refreshTokens: [],
      failedAttempts: 0,
      lockedUntil: null,
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
}

const pruneExpired = (admin) => {
  const now = Date.now();
  admin.refreshTokens = admin.refreshTokens.filter((entry) => entry.expiresAt.getTime() > now);
};
