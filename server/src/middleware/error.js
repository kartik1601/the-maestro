import multer from 'multer';
import { env } from '../config/env.js';

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

/**
 * A file an upload route will not accept. Carries its own status so the handler below
 * can pass the message through untouched — a wrong file type is the author's mistake
 * to fix, and "Something went wrong" does not tell them how.
 */
export function unsupported(message) {
  const error = new Error(message);
  error.status = 415;
  return error;
}

/**
 * Which ceiling applies, so a rejection names the right one. Read from the URL rather
 * than passed down from the route: multer rejects before any handler of ours runs.
 */
function uploadKind(url = '') {
  if (url.startsWith('/api/media/audio')) return { noun: 'recording', max: env.uploads.maxAudioBytes };
  if (url.startsWith('/api/media')) return { noun: 'image', max: env.uploads.maxImageBytes };
  return { noun: 'PDF', max: env.uploads.maxPdfBytes };
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(error, req, res, _next) {
  if (error instanceof multer.MulterError) {
    const { noun, max } = uploadKind(req.originalUrl);

    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? `That ${noun} is larger than the ${Math.round(max / (1024 * 1024))} MB limit.`
        : 'That upload could not be accepted.';
    return res.status(413).json({ error: message });
  }

  // A rejected file type. Marked by the fileFilter that refused it, so the message
  // reaches the author verbatim instead of becoming a generic 500.
  if (error?.status === 415) {
    return res.status(415).json({ error: error.message });
  }

  if (error?.name === 'ValidationError') {
    return res.status(400).json({
      error: 'That does not look right.',
      details: Object.fromEntries(
        Object.entries(error.errors ?? {}).map(([field, detail]) => [field, detail.message]),
      ),
    });
  }

  if (error?.name === 'CastError') {
    return res.status(404).json({ error: 'Not found' });
  }

  console.error('[error]', req.method, req.originalUrl, error);

  res.status(500).json({
    error: 'Something went wrong.',
    // Stack traces are for the author's terminal, never for a visitor's browser.
    ...(env.isProduction ? {} : { detail: error?.message }),
  });
}
