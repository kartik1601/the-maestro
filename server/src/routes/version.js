import { Router } from 'express';
import { Page } from '../models/page.js';
import { Post } from '../models/post.js';
import { Work } from '../models/work.js';

/**
 * A cheap "has anything changed?" endpoint for the reader-side sync indicator.
 *
 * Polling this is deliberate rather than a websocket: the site is read-mostly with a
 * single writer, so a small periodic query costs far less than holding a socket open
 * for every visitor, and it degrades to nothing when the tab is hidden.
 *
 * Each value is the newest `updatedAt` in that collection. The client compares it
 * against what it held when it rendered, and offers a refresh when they differ.
 */
export function versionRouter() {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const [posts, works, pages] = await Promise.all([
        newest(Post),
        newest(Work),
        Page.find({}, { slug: 1, updatedAt: 1 }).lean(),
      ]);

      res.set('Cache-Control', 'no-store');
      res.json({
        posts,
        works,
        // Per-slug, so a viewer reading Poems is not prompted by an edit to Novels.
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

async function newest(model) {
  const [latest] = await model.find({}, { updatedAt: 1 }).sort({ updatedAt: -1 }).limit(1).lean();
  return latest?.updatedAt?.toISOString() ?? null;
}
