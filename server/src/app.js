import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { authRouter } from './routes/auth.js';
import { postsRouter } from './routes/posts.js';
import { worksRouter } from './routes/works.js';
import { pagesRouter } from './routes/pages.js';
import { mediaRouter } from './routes/media.js';
import { versionRouter } from './routes/version.js';
import { errorHandler, notFound } from './middleware/error.js';

export function createApp() {
  const app = express();

  // Trust the first proxy hop so rate limiting keys on the real client IP once deployed.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The PDF reader renders into blob: URLs, which the default CSP would block.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const allowedOrigins = env.clientOrigin.split(',').map((origin) => origin.trim());
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and curl requests arrive without an Origin header.
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin not allowed: ${origin}`));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // The admin login surface lives behind an unguessable segment; everything else
  // is public for reading and gated per-route for writing.
  app.use(`/api/${env.adminPortalPath}/auth`, authRouter());
  app.use('/api/posts', postsRouter());
  app.use('/api/works', worksRouter());
  app.use('/api/pages', pagesRouter());
  app.use('/api/media', mediaRouter());
  app.use('/api/version', versionRouter());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
