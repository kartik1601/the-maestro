import { Router } from 'express';
import mongoose from 'mongoose';
import { TrackedLink, Visit } from '../models/visit.js';
import { requireAdmin } from '../middleware/auth.js';
import { slugify } from '../lib/slugify.js';
import { SECTION_LABELS } from './visits.js';
import { overview as letterOverview, release as releaseLetterGuard } from '../services/letter-service.js';

/** A reader is "here" until this long after their last beat — two missed beats and a bit. */
const LIVE_WINDOW_MS = 45 * 1000;
const CHART_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const RANGES = { today: 0, '7d': 7, '30d': 30, all: null };

const PLACE_LABELS = { home: 'Home', about: 'About the Author', ...SECTION_LABELS };

/**
 * The author's view of who is reading. Mounted under the portal segment and gated by
 * `requireAdmin`, so to anyone else it is one more path that does not exist.
 */
export function pulseRouter() {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', async (req, res, next) => {
    try {
      const range = Object.hasOwn(RANGES, req.query.range) ? req.query.range : '7d';
      const timezone = validTimezone(req.query.tz);
      const now = new Date();
      const inRange = rangeFilter(range, now, timezone);

      const [live, totals, days, top, links] = await Promise.all([
        liveReaders(now),
        totalsFor(inRange, now, timezone),
        viewsByDay(now, timezone),
        mostRead(inRange),
        linkRows(),
      ]);

      res.set('Cache-Control', 'no-store');
      res.json({
        range,
        checkedAt: now.toISOString(),
        live: live.map((visit) => shapeLive(visit, links, now)),
        places: placesOf(live),
        totals,
        days,
        top,
        links,
      });
    } catch (error) {
      next(error);
    }
  });

  // ── The letter on the Blogs page ──────────────────────────────────────────

  router.get('/letter', async (_req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await letterOverview());
    } catch (error) {
      next(error);
    }
  });

  /** Lifts a wait or a block and wipes that address's strikes. */
  router.delete('/letter/held/:id', async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });
      const released = await releaseLetterGuard(req.params.id);
      res.status(released ? 204 : 404).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/links', async (req, res, next) => {
    try {
      const label = String(req.body?.label ?? '').trim().slice(0, 80);
      if (!label) return res.status(400).json({ error: 'A link needs a name.' });

      const path = cleanPath(req.body?.path);
      const base = slugify(label).slice(0, 32).replace(/-+$/, '') || 'link';

      // A second "Story" gets `story-2` rather than an error the author has to read.
      let tag = base;
      for (let attempt = 2; await TrackedLink.exists({ tag }); attempt += 1) {
        tag = `${base}-${attempt}`;
      }

      const link = await TrackedLink.create({ tag, label, path });
      res.status(201).json(shapeLink(link, null));
    } catch (error) {
      next(error);
    }
  });

  /** Removes the link from the list. Visits it already brought stay counted. */
  router.delete('/links/:id', async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(404).json({ error: 'Link not found' });
      }
      const link = await TrackedLink.findByIdAndDelete(req.params.id);
      if (!link) return res.status(404).json({ error: 'Link not found' });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

// ── Live ─────────────────────────────────────────────────────────────────────

async function liveReaders(now) {
  const beating = await Visit.find({ seenAt: { $gte: new Date(now - LIVE_WINDOW_MS) } })
    .sort({ startedAt: -1 })
    .lean();

  // A reader who has just turned to another page still has the previous visit inside
  // the window. Newest per tab wins, so they are counted where they are, once.
  const seen = new Set();
  return beating.filter((visit) => {
    const key = visit.tabId || String(visit._id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const shapeLive = (visit, links, now) => ({
  id: String(visit._id),
  // Enough of the random id to tell two readers apart, and no more.
  reader: `r-${visit.visitorId.replace(/^r-/, '').slice(0, 4)}`,
  title: visit.title,
  path: visit.path,
  place: PLACE_LABELS[visit.section] ?? visit.section,
  page: visit.page,
  pages: visit.pages,
  from: describeSource(visit, links),
  seconds: Math.max(0, Math.round((now - visit.startedAt) / 1000)),
});

function describeSource(visit, links) {
  const label = visit.via ? (links.find((link) => link.tag === visit.via)?.label ?? visit.via) : '';
  if (visit.source === 'instagram') return label ? `Instagram · ${label}` : 'Instagram';
  if (label) return label;
  return { google: 'Google', direct: 'Direct', other: 'Another site' }[visit.source] ?? 'Direct';
}

/** Every place on the site, busiest first, including the ones nobody is in. */
function placesOf(live) {
  const counts = Object.fromEntries(Object.keys(PLACE_LABELS).map((key) => [key, 0]));
  for (const visit of live) {
    if (visit.section in counts) counts[visit.section] += 1;
  }
  return Object.entries(counts)
    .map(([key, count]) => ({ key, label: PLACE_LABELS[key], count }))
    .sort((a, b) => b.count - a.count);
}

// ── Totals ───────────────────────────────────────────────────────────────────

/** A tagged link counts as Instagram even when the app hides where the tap came from. */
const FROM_INSTAGRAM = { $or: [{ source: 'instagram' }, { via: { $ne: '' } }] };

async function totalsFor(inRange, now, timezone) {
  const [views, readers, today, allTime, arrivals, instagram] = await Promise.all([
    Visit.countDocuments(inRange),
    Visit.distinct('visitorId', inRange).then((ids) => ids.length),
    Visit.countDocuments(rangeFilter('today', now, timezone)),
    Visit.estimatedDocumentCount(),
    Visit.countDocuments({ ...inRange, landing: true }),
    Visit.countDocuments({ ...inRange, landing: true, ...FROM_INSTAGRAM }),
  ]);

  return { views, readers, today, allTime, arrivals, instagram };
}

async function viewsByDay(now, timezone) {
  const counted = await Visit.aggregate([
    { $match: { startedAt: { $gte: new Date(now - (CHART_DAYS + 1) * DAY_MS) } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone } },
        views: { $sum: 1 },
      },
    },
  ]);
  const byDay = new Map(counted.map((row) => [row._id, row.views]));

  // Filled from the calendar rather than from the results, so a day nobody visited is
  // a zero on the chart and not a gap that shifts every bar after it.
  return Array.from({ length: CHART_DAYS }, (_, index) => {
    const day = dayString(new Date(now - (CHART_DAYS - 1 - index) * DAY_MS), timezone);
    return { day, views: byDay.get(day) ?? 0 };
  });
}

async function mostRead(inRange) {
  const stay = { $divide: [{ $subtract: ['$seenAt', '$startedAt'] }, 1000] };

  const [ranged, allTime] = await Promise.all([
    Visit.aggregate([
      { $match: inRange },
      { $sort: { startedAt: 1 } },
      {
        $group: {
          _id: '$path',
          title: { $last: '$title' },
          section: { $last: '$section' },
          views: { $sum: 1 },
          readers: { $addToSet: '$visitorId' },
          staySeconds: { $avg: stay },
        },
      },
      { $sort: { views: -1, _id: 1 } },
      { $limit: 25 },
    ]),
    Visit.aggregate([{ $group: { _id: '$path', views: { $sum: 1 } } }]),
  ]);

  const totals = new Map(allTime.map((row) => [row._id, row.views]));

  return ranged.map((row) => ({
    path: row._id,
    title: row.title,
    place: PLACE_LABELS[row.section] ?? row.section,
    views: row.views,
    readers: row.readers.length,
    staySeconds: Math.round(row.staySeconds ?? 0),
    allTime: totals.get(row._id) ?? row.views,
  }));
}

// ── Links ────────────────────────────────────────────────────────────────────

/** All time on purpose: a link is judged by everything it ever brought. */
async function linkRows() {
  const [links, opens] = await Promise.all([
    TrackedLink.find().sort({ createdAt: -1 }).lean(),
    Visit.aggregate([
      { $match: { landing: true, ...FROM_INSTAGRAM } },
      { $group: { _id: '$via', opens: { $sum: 1 }, lastOpenedAt: { $max: '$startedAt' } } },
    ]),
  ]);
  const byTag = new Map(opens.map((row) => [row._id, row]));

  const rows = links.map((link) => shapeLink(link, byTag.get(link.tag)));

  // Taps on a plain link — the bio as it stands today — have no tag to be filed under.
  const untagged = byTag.get('');
  if (untagged) {
    rows.push({
      id: null,
      tag: '',
      label: 'Instagram, untagged',
      path: '',
      opens: untagged.opens,
      lastOpenedAt: untagged.lastOpenedAt,
    });
  }
  return rows;
}

const shapeLink = (link, stats) => ({
  id: String(link._id),
  tag: link.tag,
  label: link.label,
  path: link.path,
  opens: stats?.opens ?? 0,
  lastOpenedAt: stats?.lastOpenedAt ?? null,
});

// ── Ranges and days ──────────────────────────────────────────────────────────

/**
 * "Today" means the author's today, not the server's — the API runs in UTC, and a
 * reader at one in the morning in Kolkata would otherwise be filed under yesterday.
 */
function rangeFilter(range, now, timezone) {
  const days = RANGES[range];
  if (days === null) return {};
  if (days > 0) return { startedAt: { $gte: new Date(now - days * DAY_MS) } };

  return {
    $expr: {
      $eq: [
        { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone } },
        dayString(now, timezone),
      ],
    },
    // Lets the index narrow it first; no timezone is more than a day from another.
    startedAt: { $gte: new Date(now - 2 * DAY_MS) },
  };
}

const dayString = (date, timeZone) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

function validTimezone(value) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: String(value) }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** A site path and nothing else — it is pasted into a URL the author hands out. */
function cleanPath(value) {
  const path = String(value ?? '').trim().split(/[?#]/)[0];
  return /^\/[a-z0-9\-/]{0,120}$/i.test(path) ? path : '/';
}
