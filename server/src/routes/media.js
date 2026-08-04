import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { env } from '../config/env.js';
import { Media } from '../models/media.js';
import { requireAdmin } from '../middleware/auth.js';
import { unsupported } from '../middleware/error.js';
import { buildKey, isConfigured, putObject, resolveUrl } from '../storage/blob-store.js';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

/**
 * Audio types are recognised by extension as well as MIME type. The same `.m4a` file
 * is announced as `audio/x-m4a`, `audio/mp4` or `audio/aac` depending on the operating
 * system, and some browsers hand over an empty type for anything they do not know —
 * so the extension is the reliable half of the check and the MIME type is the hint.
 */
const AUDIO_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave',
  'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/ogg', 'audio/opus',
  'audio/flac', 'audio/x-flac', 'audio/webm',
]);
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|mp4a|aac|ogg|oga|opus|flac|weba|webm)$/i;

/** What the browser must be told, since half the uploads arrive mislabelled. */
const AUDIO_CONTENT_TYPES = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
  webm: 'audio/webm',
};

const audioContentType = (file) => {
  const extension = String(file.originalname ?? '').match(AUDIO_EXTENSIONS)?.[1]?.toLowerCase();
  return AUDIO_CONTENT_TYPES[extension] ?? (AUDIO_TYPES.has(file.mimetype) ? file.mimetype : 'audio/mpeg');
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploads.maxImageBytes, files: 1 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(unsupported('Only PNG, JPEG, WebP, GIF or AVIF images can be uploaded.'));
    }
    cb(null, true);
  },
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploads.maxAudioBytes, files: 1 },
  fileFilter(_req, file, cb) {
    if (!AUDIO_TYPES.has(file.mimetype) && !AUDIO_EXTENSIONS.test(file.originalname ?? '')) {
      return cb(unsupported('That is not an audio file. Try MP3, WAV, M4A, AAC, OGG or FLAC.'));
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

      // Anything in the bucket is served publicly — images and audio only ever appear
      // inside published prose, and the CDN should be the one serving them. Audio in
      // particular needs the range requests R2 answers natively; a redirect keeps the
      // player talking to the bucket rather than pulling whole files through here.
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

  /**
   * Audio for a poem or a song.
   *
   * The bucket is required rather than optional here, unlike images. A recording is
   * tens of megabytes and is seeked around by the player, which needs byte ranges —
   * neither of which a BSON document can offer. Refusing outright is clearer than
   * quietly filling a 512 MB free tier with one song.
   */
  router.post('/audio', requireAdmin, audioUpload.single('audio'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No audio received.' });

      if (!isConfigured()) {
        return res.status(503).json({
          error: 'Audio needs Cloudflare R2. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, ' +
            'R2_SECRET_ACCESS_KEY and R2_BUCKET — see .claude/API_KEYS.md.',
        });
      }

      const contentType = audioContentType(req.file);
      const objectKey = await putObject({
        key: buildKey('audio', req.file.originalname),
        body: req.file.buffer,
        contentType,
      });

      const media = await Media.create({
        kind: 'audio',
        storage: 'r2',
        objectKey,
        data: null,
        contentType,
        byteSize: req.file.size,
        originalName: req.file.originalname,
      });

      res.status(201).json({
        id: media.id,
        // Relative, like images: the same document works on localhost and in production.
        url: `/api/media/${media.id}`,
        byteSize: media.byteSize,
        contentType: media.contentType,
        originalName: media.originalName,
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
