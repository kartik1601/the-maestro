import { Router } from 'express';
import { Page } from '../models/page.js';
import { Post } from '../models/post.js';
import { SECTIONS, Work } from '../models/work.js';
import { attachAdmin } from '../middleware/auth.js';

/**
 * A cheap "has anything changed?" endpoint for the reader-side sync indicator.
 *
 * Polling this is deliberate rather than a websocket: the site is read-mostly with a
 * single writer, so a small periodic query costs far less than holding a socket open
 * for every visitor, and it degrades to nothing when the tab is hidden.
 *
 * Each value is the newest `updatedAt` a given viewer could actually see. The client
 * compares it against what it held when it rendered, and offers a refresh when they
 * differ. Two things this must get right, or the pill becomes noise a reader learns
 * to ignore:
 *
 *   - **Only what the viewer can see.** Drafts are the author's alone, so a draft
 *     saved five times an afternoon must not send every reader a refresh that brings
 *     back the identical page. `attachAdmin` rather than `requireAdmin`: the author
 *     is watching the same site plus their own unpublished work.
 *   - **Only where they are looking.** `works` is keyed by section for the same
 *     reason `pages` is keyed by slug — a song saved in Songs is not news to someone
 *     reading Poems.
 */
export function versionRouter() {
  const router = Router();

  router.get('/', attachAdmin, async (req, res, next) => {
    try {
      const visible = req.admin ? {} : { published: true };

      const [posts, works, pages] = await Promise.all([
        newest(Post, visible),
        newestPerSection(visible),
        Page.find(visible, { slug: 1, updatedAt: 1 }).lean(),
      ]);

      res.set('Cache-Control', 'no-store');
      res.json({
        posts,
        works,
        pages: Object.fromEntries(
          pages.map((page) => [page.slug, page.updatedAt?.toISOString() ?? null]),
        ),
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function newest(model, filter) {
  const [latest] = await model.find(filter, { updatedAt: 1 }).sort({ updatedAt: -1 }).limit(1).lean();
  return latest?.updatedAt?.toISOString() ?? null;
}

/**
 * The newest visible work in each of the five sections, as one aggregation rather
 * than five queries — this runs on every reader's poll.
 *
 * Every section is present in the answer, null included. A section that gains its
 * first work has to read as a change from what the client held, and a key that was
 * absent and is now set would otherwise be indistinguishable from one that was
 * always there.
 */
async function newestPerSection(filter) {
  const rows = await Work.aggregate([
    { $match: filter },
    { $group: { _id: '$section', updatedAt: { $max: '$updatedAt' } } },
  ]);

  const newestOf = new Map(rows.map((row) => [row._id, row.updatedAt?.toISOString() ?? null]));
  return Object.fromEntries(SECTIONS.map((section) => [section, newestOf.get(section) ?? null]));
}
