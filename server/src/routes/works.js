import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { env } from '../config/env.js';
import { SECTIONS, Work, WORK_LIST_PROJECTION } from '../models/work.js';
import { attachAdmin, requireAdmin } from '../middleware/auth.js';
import { unsupported } from '../middleware/error.js';
import { excerptFrom, readingMinutes, sanitizeRichText } from '../lib/sanitize.js';
import { slugify } from '../lib/slugify.js';
import { buildKey, deleteObject, isConfigured, putObject, resolveUrl } from '../storage/blob-store.js';

/**
 * PDFs are held in memory only long enough to copy them into the document, per the
 * spec's "store as a byte array inside DB". The size ceiling keeps a document
 * clear of MongoDB's hard 16 MB BSON limit.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploads.maxPdfBytes, files: 1 },
  fileFilter(_req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      return cb(unsupported('Only PDF files can be uploaded.'));
    }
    cb(null, true);
  },
});

export function worksRouter() {
  const router = Router();

  router.get('/:section', attachAdmin, async (req, res, next) => {
    const { section } = req.params;
    if (!SECTIONS.includes(section)) {
      return res.status(404).json({ error: 'Unknown section' });
    }

    try {
      const filter = { section, ...(req.admin ? {} : { published: true }) };
      if (req.query.collection) filter.collectionKey = String(req.query.collection);

      const works = await Work.find(filter)
        .select(WORK_LIST_PROJECTION)
        // Pinned first ('Last Words of a Lost Man'), then series order, then manual order.
        .sort({ pinned: -1, seriesNumber: 1, sortOrder: 1, title: 1 })
        .lean({ virtuals: true });

      res.json({ section, works: works.map(shapeWork) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:section/:slug', attachAdmin, async (req, res, next) => {
    try {
      const work = await findVisibleWork(req);
      if (!work) return res.status(404).json({ error: 'Work not found' });

      const json = work.toJSON();
      res.json(shapeWork({ ...json, body: work.body }));
    } catch (error) {
      next(error);
    }
  });

  /**
   * Where the document actually lives.
   *
   * The client asks this first and, when it gets a URL back, points pdf.js straight
   * at it. That is deliberate rather than redirecting from the endpoint below: the
   * client's requests carry an Authorization header, which makes them preflighted,
   * and CORS forbids following a redirect on a preflighted request. Handing over a
   * URL sidesteps that entirely — and lets pdf.js issue its own range requests, which
   * is the reason for using object storage in the first place.
   *
   * The visibility check still happens here, so no URL is minted for a draft without
   * a session.
   */
  router.get('/:section/:slug/pdf-link', attachAdmin, async (req, res, next) => {
    try {
      const work = await findVisibleWork(req);
      if (!work?.pdf?.byteSize) return res.status(404).json({ error: 'No PDF for this work' });

      if (work.pdf.storage === 'r2' && work.pdf.objectKey) {
        return res.json({ url: await resolveUrl(work.pdf.objectKey, { public: work.published }) });
      }

      // Stored in MongoDB: no URL to hand out, the client fetches the bytes instead.
      res.json({ url: null });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Streams the bytes for documents held in MongoDB. Still redirects for R2-backed
   * files so a direct link or a curl keeps working, but the client uses pdf-link.
   */
  router.get('/:section/:slug/pdf', attachAdmin, async (req, res, next) => {
    try {
      const work = await findVisibleWork(req, { includePdf: true });
      if (!work?.pdf?.byteSize) return res.status(404).json({ error: 'No PDF for this work' });

      if (work.pdf.storage === 'r2' && work.pdf.objectKey) {
        const url = await resolveUrl(work.pdf.objectKey, { public: work.published });
        return res.redirect(302, url);
      }

      if (!work.pdf.data) return res.status(404).json({ error: 'No PDF for this work' });

      res.set({
        'Content-Type': work.pdf.contentType ?? 'application/pdf',
        'Content-Length': String(work.pdf.data.length),
        'Content-Disposition': `inline; filename="${encodeURIComponent(work.slug)}.pdf"`,
        // Unpublished drafts must never land in a shared cache.
        'Cache-Control': work.published ? 'public, max-age=3600' : 'no-store',
      });
      res.send(work.pdf.data);
    } catch (error) {
      next(error);
    }
  });

  router.post('/', requireAdmin, async (req, res, next) => {
    try {
      const payload = readWorkPayload(req.body ?? {});
      if (!SECTIONS.includes(payload.section)) {
        return res.status(400).json({ error: 'Unknown section' });
      }
      if (!payload.title) {
        return res.status(400).json({ error: 'A work needs a title.' });
      }

      const work = await Work.create({
        ...payload,
        slug: payload.slug || slugify(payload.title),
      });

      res.status(201).json(shapeWork(work.toJSON()));
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ error: 'A work with that slug already exists here.' });
      }
      next(error);
    }
  });

  /**
   * Manual shelf order, for Poems and Songs where nothing else decides it — no series
   * number to follow and no reason for alphabetical. The ids arrive in the order they
   * should appear and become sortOrder 0..n, which is what the list query sorts on.
   *
   * Declared ahead of '/:id' routes for readability only; the paths cannot collide.
   */
  router.put('/reorder', requireAdmin, async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (ids.length === 0) return res.status(400).json({ error: 'No order received.' });
      if (!ids.every((id) => mongoose.isValidObjectId(id))) {
        return res.status(400).json({ error: 'That is not a work id.' });
      }

      await Work.bulkWrite(
        ids.map((id, index) => ({
          updateOne: { filter: { _id: id }, update: { $set: { sortOrder: index } } },
        })),
      );

      res.json({ ordered: ids.length });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', requireAdmin, async (req, res, next) => {
    try {
      const payload = readWorkPayload(req.body ?? {}, { partial: true });

      const existing = await Work.findById(req.params.id).select('section title slug');
      if (!existing) return res.status(404).json({ error: 'Work not found' });

      // A renamed work has to answer to a new address. The slug was made from the old
      // title, so leaving it behind would have every link and every card pointing at a
      // name the work no longer carries.
      if (payload.title && payload.title !== existing.title && payload.slug === undefined) {
        payload.slug = await freeSlug(existing.section, payload.title, existing._id);
      }

      const work = await Work.findByIdAndUpdate(req.params.id, payload, { returnDocument: 'after' });
      if (!work) return res.status(404).json({ error: 'Work not found' });

      res.json(shapeWork({ ...work.toJSON(), body: work.body }));
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ error: 'A work with that slug already exists here.' });
      }
      next(error);
    }
  });

  router.put('/:id/pdf', requireAdmin, upload.single('pdf'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No PDF received.' });

      const previous = await Work.findById(req.params.id).select('pdf.objectKey pdf.storage');
      if (!previous) return res.status(404).json({ error: 'Work not found' });

      const pdf = {
        contentType: req.file.mimetype,
        byteSize: req.file.size,
        pageCount: countPdfPages(req.file.buffer),
        originalName: req.file.originalname,
        uploadedAt: new Date(),
      };

      if (isConfigured()) {
        const objectKey = buildKey('pdf', req.file.originalname);
        await putObject({ key: objectKey, body: req.file.buffer, contentType: req.file.mimetype });
        Object.assign(pdf, { storage: 'r2', objectKey, data: null });
      } else {
        Object.assign(pdf, { storage: 'mongo', objectKey: null, data: req.file.buffer });
      }

      const work = await Work.findByIdAndUpdate(
        req.params.id,
        { pdf },
        { returnDocument: 'after' },
      ).select(WORK_LIST_PROJECTION);

      // Only once the replacement is safely recorded.
      if (previous.pdf?.objectKey) await deleteObject(previous.pdf.objectKey);

      res.json(shapeWork(work.toJSON()));
    } catch (error) {
      next(error);
    }
  });

  /** Removes the file but keeps the work, so the shelf entry survives a re-upload. */
  router.delete('/:id/pdf', requireAdmin, async (req, res, next) => {
    try {
      const previous = await Work.findById(req.params.id).select('pdf.objectKey');
      if (!previous) return res.status(404).json({ error: 'Work not found' });

      const work = await Work.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            pdf: {
              storage: 'mongo',
              objectKey: null,
              data: null,
              contentType: null,
              byteSize: 0,
              pageCount: null,
              originalName: null,
              uploadedAt: null,
            },
          },
        },
        { returnDocument: 'after' },
      ).select(WORK_LIST_PROJECTION);

      await deleteObject(previous.pdf?.objectKey);
      res.json(shapeWork(work.toJSON()));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', requireAdmin, async (req, res, next) => {
    try {
      const work = await Work.findByIdAndDelete(req.params.id);
      if (!work) return res.status(404).json({ error: 'Work not found' });

      // The document is gone; its file would otherwise sit in the bucket forever.
      await deleteObject(work.pdf?.objectKey);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function findVisibleWork(req, { includePdf = false } = {}) {
  const query = Work.findOne({ section: req.params.section, slug: req.params.slug });
  if (!includePdf) query.select('-pdf.data');

  const work = await query;
  if (!work) return null;
  // Drafts exist for the author alone.
  if (!work.published && !req.admin) return null;
  return work;
}

/**
 * The slug a title should have, with a numeric suffix if a sibling already holds it.
 *
 * A rename must never fail: two poems are allowed to share a title, and refusing the
 * save would leave the author looking at an error over an edit that is perfectly
 * legitimate. Creation still 409s on a clash — there the author can simply pick again.
 *
 * The pattern is built from an already-slugified root, so it holds nothing but
 * [a-z0-9-] and cannot carry regex syntax into the query.
 */
async function freeSlug(section, title, excludeId) {
  const root = slugify(title) || 'untitled';

  const siblings = await Work.find({
    section,
    _id: { $ne: excludeId },
    slug: new RegExp(`^${root}(-\\d+)?$`),
  })
    .select('slug')
    .lean();

  const taken = new Set(siblings.map((row) => row.slug));
  if (!taken.has(root)) return root;

  for (let n = 2; ; n += 1) {
    if (!taken.has(`${root}-${n}`)) return `${root}-${n}`;
  }
}

function readWorkPayload(body, { partial = false } = {}) {
  const payload = {};
  const assign = (key, value) => {
    if (value !== undefined) payload[key] = value;
  };

  if (!partial) {
    payload.section = body.section;
    payload.kind = body.kind ?? (body.section === 'poems' || body.section === 'songs' ? 'document' : 'upload');
  }

  assign('title', body.title?.trim());
  assign('subtitle', body.subtitle?.trim());
  assign('summary', body.summary?.trim());
  assign('collectionKey', body.collectionKey?.trim().toLowerCase());
  assign('tintWord', body.tintWord?.trim());
  assign('pinned', body.pinned === undefined ? undefined : Boolean(body.pinned));
  assign('sortOrder', body.sortOrder === undefined ? undefined : Number(body.sortOrder));
  assign(
    'seriesNumber',
    body.seriesNumber === undefined ? undefined : Number(body.seriesNumber) || null,
  );
  if (body.slug !== undefined) payload.slug = slugify(body.slug);

  if (body.body !== undefined) {
    payload.body = sanitizeRichText(body.body);
    payload.excerpt = excerptFrom(payload.body);
    payload.readingMinutes = readingMinutes(payload.body);
    payload.videoId = firstVideoId(payload.body);
  }

  if (body.published !== undefined) {
    payload.published = Boolean(body.published);
    // First publish stamps the date; unpublishing and republishing keeps the original.
    if (payload.published) payload.publishedAt = body.publishedAt ?? new Date();
  }

  return payload;
}

/**
 * The id of the first video in a body, read straight out of the stored markup.
 *
 * Safe to do with a regex rather than a parser: the attribute is written by the editor
 * and has already been through the sanitizer, so by the time this runs the only thing
 * `data-youtube` can hold is an eleven-character id.
 */
function firstVideoId(html) {
  return String(html ?? '').match(/data-youtube="([\w-]{11})"/)?.[1] ?? '';
}

/**
 * Page count without a PDF parsing dependency: every page in a PDF is an object
 * with /Type /Page, so counting those markers is accurate for the linearized
 * files a writer exports from Word, Pages, or Scrivener. Reported as a hint only —
 * the reader takes the authoritative count from pdf.js once the file loads.
 */
function countPdfPages(buffer) {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : null;
}

const shapeWork = (work) => ({
  id: String(work._id ?? work.id),
  section: work.section,
  kind: work.kind,
  title: work.title,
  slug: work.slug,
  subtitle: work.subtitle,
  summary: work.summary,
  collectionKey: work.collectionKey,
  seriesNumber: work.seriesNumber,
  tintWord: work.tintWord ?? '',
  videoId: work.videoId ?? '',
  sortOrder: work.sortOrder ?? 0,
  pinned: work.pinned,
  published: work.published,
  excerpt: work.excerpt,
  readingMinutes: work.readingMinutes,
  publishedAt: work.publishedAt,
  updatedAt: work.updatedAt,
  ...(work.body !== undefined ? { body: work.body } : {}),
  pdf: {
    hasFile: Boolean(work.pdf?.byteSize),
    byteSize: work.pdf?.byteSize ?? 0,
    pageCount: work.pdf?.pageCount ?? null,
    originalName: work.pdf?.originalName ?? null,
    uploadedAt: work.pdf?.uploadedAt ?? null,
  },
});
