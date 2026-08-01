import { verifyAccessToken } from '../services/auth-service.js';

/**
 * Populates req.admin when a valid access token is present, and does nothing when
 * it is not. Used on public read routes that render extra affordances (drafts,
 * edit controls) for the author.
 */
export function attachAdmin(req, _res, next) {
  const token = bearerFrom(req);
  if (token) {
    try {
      req.admin = verifyAccessToken(token);
    } catch {
      // An expired or malformed token simply means "not the admin" on public routes.
    }
  }
  next();
}

/**
 * Hard gate for every write. Responds 404 rather than 401 so that probing an admin
 * endpoint without credentials is indistinguishable from probing a path that does
 * not exist — the spec asks that others not even see the route.
 */
export function requireAdmin(req, res, next) {
  const token = bearerFrom(req);
  if (!token) return res.status(404).json({ error: 'Not found' });

  try {
    req.admin = verifyAccessToken(token);
    return next();
  } catch (error) {
    // The client needs to tell "refresh me" apart from "you were never allowed here".
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(404).json({ error: 'Not found' });
  }
}

const bearerFrom = (req) => {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  return /^bearer$/i.test(scheme) && token ? token.trim() : null;
};
