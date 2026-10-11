import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { SECTIONS, Work } from '../models/work.js';
import { SOURCES, Visit } from '../models/visit.js';
import { attachAdmin } from '../middleware/auth.js';

/**
 * Generous for a person and tight for a script: a reader opens a page and beats every
 * twenty seconds, which is a handful of requests a minute. Without a ceiling anyone
 * could inflate the author's numbers with a loop.
 */
const visitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Slow down' },
});

const SECTION_LABELS = {
  novels: 'Novels',
  poems: 'Poems',
  songs: 'Songs',
  plays: 'Plays',
  novelettes: 'Novelettes',
};

/**
 * What readers report about themselves: that they opened a page, and that they are
 * still on it. Public, and deliberately quiet — every outcome that is not a recorded
 * visit answers 204, so the client never has anything to handle.
 */
export function visitsRouter() {
  const router = Router();

  router.post('/', visitLimiter, attachAdmin, async (req, res, next) => {
    try {
      // The author reading their own site is not a reader.
      if (req.admin) return res.status(204).end();

      const visitorId = readVisitorId(req);
      const place = visitorId ? await resolvePlace(req.body?.path) : null;
      if (!place) return res.status(204).end();

      const { tab, source, via, landing } = req.body ?? {};

      const visit = await Visit.create({
        visitorId,
        tabId: cleanToken(tab, 64),
        ...place,
        source: SOURCES.includes(source) ? source : 'direct',
        via: cleanToken(via, 40).toLowerCase(),
        landing: landing === true,
      });

      res.status(201).json({ id: String(visit._id) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/beat', visitLimiter, async (req, res, next) => {
    try {
      const { id } = req.params;
      const visitorId = readVisitorId(req);
      if (!mongoose.isValidObjectId(id) || !visitorId) return res.status(204).end();

      const updates = { seenAt: new Date() };
      const page = positiveInt(req.body?.page);
      const pages = positiveInt(req.body?.pages);
      if (page && pages && page <= pages) Object.assign(updates, { page, pages });

      // Matched on the visitor as well as the id, so one reader cannot keep another's
      // visit alive by guessing ids.
      await Visit.updateOne({ _id: id, visitorId }, { $set: updates });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * Turns a client-reported path into the place it names — or null when it names
 * nothing a reader can see. The title comes from the database rather than the
 * request, so the dashboard can only ever show the author's own words.
 */
async function resolvePlace(rawPath) {
  const path = String(rawPath ?? '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (path.length > 200) return null;

  if (path === '/') return { path, section: 'home', title: 'Blogs' };
  if (path === '/about') return { path, section: 'about', title: 'About the Author' };

  const [, section, slug, extra] = path.split('/');
  if (!SECTIONS.includes(section) || extra !== undefined) return null;
  if (!slug) return { path, section, title: SECTION_LABELS[section] };

  const work = await Work.findOne({ section, slug: slug.toLowerCase(), published: true })
    .select('title')
    .lean();
  return work ? { path, section, title: work.title } : null;
}

const readVisitorId = (req) => {
  const value = String(req.get('x-reactor-id') ?? '').trim();
  return value.length >= 8 && value.length <= 128 ? value : '';
};

/** Letters, digits and dashes only — these values are echoed onto the dashboard. */
const cleanToken = (value, max) =>
  String(value ?? '')
    .replace(/[^a-z0-9-]/gi, '')
    .slice(0, max);

const positiveInt = (value) => (Number.isInteger(value) && value > 0 && value < 100000 ? value : null);

export { SECTION_LABELS };
