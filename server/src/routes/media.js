import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { env } from '../config/env.js';
import { Media } from '../models/media.js';
import { requireAdmin } from '../middleware/auth.js';
import { buildKey, isConfigured, putObject, resolveUrl } from '../storage/blob-store.js';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploads.maxImageBytes, files: 1 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error('Only PNG, JPEG, WebP, GIF or AVIF images can be uploaded.'));
    }
    cb(null, true);
  },
});

export function mediaRouter() {
  const router = Router();

  /** Public — every image referenced by published writing is served from here. */
  router.get('/:id', async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: 'Not found' });
    }

    try {
      const media = await Media.findById(req.params.id);
      if (!media) return res.status(404).json({ error: 'Not found' });

      // Images in the bucket are always public — they only ever appear inside
      // published prose, and the CDN should be the one serving them.
      if (media.storage === 'r2' && media.objectKey) {
        return res.redirect(302, await resolveUrl(media.objectKey, { public: true }));
      }

      if (!media.data) return res.status(404).json({ error: 'Not found' });

      res.set({
        'Content-Type': media.contentType,
        'Content-Length': String(media.data.length),
        // Content is immutable once uploaded — a change produces a new id.
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      res.send(media.data);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Replaces a singleton image in place. The document — and therefore its id — is
   * reused, so the author can swap their portrait as often as they like without
   * leaving a trail of orphaned copies behind. The returned URL carries a version so
   * browsers still pick up the change.
   */
  router.put('/key/:key', requireAdmin, upload.single('image'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No image received.' });

      const key = String(req.params.key).toLowerCase().slice(0, 60);
      if (!/^[a-z0-9-]+$/.test(key)) {
        return res.status(400).json({ error: 'Invalid media key.' });
      }

      // Keyed media stays in MongoDB on purpose — the portrait is one small file, and
      // keeping it in the database means the About page never depends on the bucket.
      const media = await Media.findOneAndUpdate(
        { key },
        {
          $set: {
            key,
            storage: 'mongo',
            objectKey: null,
            data: req.file.buffer,
            contentType: req.file.mimetype,
            byteSize: req.file.size,
            originalName: req.file.originalname,
            alt: String(req.body?.alt ?? '').slice(0, 300),
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
      );

      res.json({
        id: media.id,
        url: `/api/media/${media.id}?v=${media.version}`,
        byteSize: media.byteSize,
        contentType: media.contentType,
        version: media.version,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', requireAdmin, upload.single('image'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No image received.' });

      // Prose images go to the bucket when it is available; the portrait does not
      // take this path — it is keyed, and keyed uploads stay in MongoDB.
      const placement = isConfigured()
        ? {
            storage: 'r2',
            objectKey: await putObject({
              key: buildKey('image', req.file.originalname),
              body: req.file.buffer,
              contentType: req.file.mimetype,
            }),
            data: null,
          }
        : { storage: 'mongo', objectKey: null, data: req.file.buffer };

      const media = await Media.create({
        ...placement,
        contentType: req.file.mimetype,
        byteSize: req.file.size,
        originalName: req.file.originalname,
        alt: String(req.body?.alt ?? '').slice(0, 300),
      });

      res.status(201).json({
        id: media.id,
        // Relative on purpose: the same document works on localhost and in production.
        url: `/api/media/${media.id}`,
        byteSize: media.byteSize,
        contentType: media.contentType,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
