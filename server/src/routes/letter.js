import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import {
  content,
  redeemOtp,
  requestOtp,
  status,
  unlock,
  verifyToken,
  verifyVideoToken,
} from '../services/letter-service.js';
import { findVideo, openVideo } from '../services/letter-video.js';

/**
 * An outer ceiling on top of the gate's own rules. The gate already allows one try
 * per fifteen minutes; this stops a script from hammering the endpoints themselves,
 * each answer check costing a 64 MB scrypt.
 */
const letterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: 'Slow down' },
});

/** See `env.letter.trustCfConnectingIp` for why this is not simply `req.ip`. */
export function clientIp(req) {
  if (env.letter.trustCfConnectingIp) {
    const forwarded = String(req.get('cf-connecting-ip') ?? '').trim();
    if (forwarded) return forwarded;
  }
  return req.ip ?? '';
}

/**
 * Looser than the gate's: a player asks for the video in many small ranges as it
 * buffers and seeks. Still a ceiling, so the token cannot be used to pull it on a loop.
 */
const videoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: 'Slow down' },
});

export function letterRouter() {
  const router = Router();

  // Before the gate's limiter, which a single playthrough would otherwise use up.
  router.get('/video/:quality', videoLimiter, async (req, res, next) => {
    try {
      if (!verifyVideoToken(req.query.t)) return res.status(404).json({ error: 'Not found' });
      const file = await findVideo(req.params.quality);
      if (!file) return res.status(404).json({ error: 'Not found' });

      const size = file.length;
      res.set({
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        // Private to this browser; the token in the URL keeps any cache per-reader.
        'Cache-Control': 'private, max-age=7200',
      });

      let start = 0;
      let end = size - 1;
      const range = req.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (match && match[1] === '' && match[2] !== '') {
          start = Math.max(0, size - Number(match[2]));
        } else if (match && match[1] !== '') {
          start = Number(match[1]);
          if (match[2] !== '') end = Math.min(Number(match[2]), size - 1);
        }
        if (!match || start >= size || start > end) {
          return res.status(416).set('Content-Range', `bytes */${size}`).end();
        }
        res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
      }
      res.set('Content-Length', String(end - start + 1));
      if (req.method === 'HEAD') return res.end();

      const stream = openVideo(file, start, end);
      stream.on('error', (error) => (res.headersSent ? res.destroy(error) : next(error)));
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  });

  router.use(letterLimiter);

  router.get('/status', async (req, res, next) => {
    try {
      res.json(await status(clientIp(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/unlock', async (req, res, next) => {
    try {
      const { name, privateHandle, publicHandle, dob } = req.body ?? {};
      res.json(await unlock(clientIp(req), { name, privateHandle, publicHandle, dob }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/request-otp', async (req, res, next) => {
    try {
      res.json(await requestOtp(clientIp(req), req.body?.email));
    } catch (error) {
      next(error);
    }
  });

  router.post('/otp', async (req, res, next) => {
    try {
      res.json(await redeemOtp(clientIp(req), req.body?.code));
    } catch (error) {
      next(error);
    }
  });

  router.get('/content', async (req, res, next) => {
    try {
      if (!verifyToken(req.get('x-letter-token'))) return res.status(404).json({ error: 'Not found' });
      res.set('cache-control', 'no-store');
      res.json(await content());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
