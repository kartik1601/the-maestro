import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import ms from '../lib/ms.js';
import { env } from '../config/env.js';
import {
  AuthError,
  authenticateAdmin,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../services/auth-service.js';
import { requireAdmin } from '../middleware/auth.js';

const REFRESH_COOKIE = 'maestro_rt';

/**
 * Slow enough to make three-factor guessing hopeless, generous enough that the
 * author fat-fingering their own auth key twice is not an incident.
 */
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Not found' },
});

export function authRouter() {
  const router = Router();

  router.post('/login', loginLimiter, async (req, res, next) => {
    const { username, password, authKey } = req.body ?? {};

    if (!username || !password || !authKey) {
      // Same shape as a credential failure — absence of a factor is still just "no".
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
      const result = await authenticateAdmin({
        username,
        password,
        authKey,
        userAgent: req.get('user-agent') ?? '',
      });

      setRefreshCookie(res, result.refreshToken);
      return res.json({
        accessToken: result.accessToken,
        admin: { displayName: result.admin.displayName },
      });
    } catch (error) {
      if (error instanceof AuthError) {
        console.warn(`[auth] login rejected (${error.reason}) from ${req.ip}`);
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      return next(error);
    }
  });

  router.post('/refresh', async (req, res, next) => {
    const presented = req.cookies?.[REFRESH_COOKIE];
    if (!presented) return res.status(401).json({ error: 'Invalid session' });

    try {
      const result = await rotateRefreshToken(presented, {
        userAgent: req.get('user-agent') ?? '',
      });

      setRefreshCookie(res, result.refreshToken);
      return res.json({
        accessToken: result.accessToken,
        admin: { displayName: result.admin.displayName },
      });
    } catch (error) {
      if (error instanceof AuthError) {
        console.warn(`[auth] refresh rejected (${error.reason}) from ${req.ip}`);
        clearRefreshCookie(res);
        return res.status(401).json({ error: 'Invalid session' });
      }
      return next(error);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
      clearRefreshCookie(res);
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me', requireAdmin, (req, res) => {
    res.json({ displayName: req.admin.name, role: req.admin.role });
  });

  return router;
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.cookies.secure,
  sameSite: env.cookies.sameSite,
  // Scoped to the portal so the refresh token is not attached to ordinary reads.
  path: `/api/${env.adminPortalPath}/auth`,
});

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions(),
    maxAge: ms(env.jwt.refreshTtl),
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}
