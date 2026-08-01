import multer from 'multer';
import { env } from '../config/env.js';

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(error, req, res, _next) {
  if (error instanceof multer.MulterError) {
    // The two upload routes have different ceilings, so name the right one.
    const isImage = req.path.startsWith('/api/media') || req.baseUrl?.endsWith('/media');
    const limitMb = Math.round(
      (isImage ? env.uploads.maxImageBytes : env.uploads.maxPdfBytes) / (1024 * 1024),
    );

    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? `That ${isImage ? 'image' : 'PDF'} is larger than the ${limitMb} MB limit.`
        : 'That upload could not be accepted.';
    return res.status(413).json({ error: message });
  }

  if (/can be uploaded\.$/.test(error?.message ?? '')) {
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
