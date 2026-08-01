import { Router } from 'express';
import mongoose from 'mongoose';
import { EMOTES, Post, Reaction } from '../models/post.js';
import { attachAdmin, requireAdmin } from '../middleware/auth.js';
import { sanitizeRichText } from '../lib/sanitize.js';

export function postsRouter() {
  const router = Router();

  /** The feed. Drafts are folded in only when the author is the one looking. */
  router.get('/', attachAdmin, async (req, res, next) => {
    try {
      const reactorId = readReactorId(req);
      const filter = req.admin ? {} : { published: true };

      const posts = await Post.find(filter)
        .sort({ pinned: -1, createdAt: -1 })
        .limit(Math.min(Number(req.query.limit) || 50, 100))
        .populate('linkedWork', 'title slug section collectionKey')
        .lean({ virtuals: true });

      // One query for the viewer's own reactions across the whole page of posts,
      // so the feed can render pressed states without an N+1.
      const mine = reactorId
        ? await Reaction.find({
            post: { $in: posts.map((post) => post._id) },
            reactorId,
          }).lean()
        : [];

      const minePerPost = new Map();
      for (const reaction of mine) {
        const key = String(reaction.post);
        if (!minePerPost.has(key)) minePerPost.set(key, []);
        minePerPost.get(key).push(reaction.emote);
      }

      res.json({
        emotes: EMOTES,
        posts: posts.map((post) => shapePost(post, minePerPost.get(String(post._id)) ?? [])),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Toggle a single emote. Anonymous by design — the reactor id is a random value
   * the browser keeps in localStorage, which is the least amount of identity that
   * still lets someone take their own reaction back.
   */
  router.post('/:id/reactions', async (req, res, next) => {
    const { id } = req.params;
    const { emote } = req.body ?? {};
    const reactorId = readReactorId(req);

    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ error: 'Post not found' });
    }
    if (!EMOTES.includes(emote)) {
      return res.status(400).json({ error: `Unknown emote. Expected one of: ${EMOTES.join(', ')}` });
    }
    if (!reactorId) {
      return res.status(400).json({ error: 'Missing reactor id' });
    }

    try {
      const post = await Post.findOne({ _id: id, published: true });
      if (!post) return res.status(404).json({ error: 'Post not found' });

      const existing = await Reaction.findOneAndDelete({ post: id, reactorId, emote });

      let reacted;
      if (existing) {
        reacted = false;
      } else {
        try {
          await Reaction.create({ post: id, reactorId, emote });
          reacted = true;
        } catch (error) {
          // Duplicate key: a double-tap raced us and the reaction already exists.
          // The desired end state is "reacted", so report success without a second increment.
          if (error?.code === 11000) {
            return res.json({ emote, reacted: true, counts: countsOf(post) });
          }
          throw error;
        }
      }

      // $inc on the denormalized tally keeps the feed read cheap. The reactions
      // collection stays the source of truth if a rebuild is ever needed.
      const updated = await Post.findByIdAndUpdate(
        id,
        { $inc: { [`reactionCounts.${emote}`]: reacted ? 1 : -1 } },
        { returnDocument: 'after' },
      );

      res.json({ emote, reacted, counts: countsOf(updated) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', requireAdmin, async (req, res, next) => {
    try {
      const { body, linkedWork, pinned, published } = req.body ?? {};
      const clean = sanitizeRichText(body);

      if (!clean.trim()) {
        return res.status(400).json({ error: 'A post needs something to say.' });
      }

      const post = await Post.create({
        body: clean,
        linkedWork: mongoose.isValidObjectId(linkedWork) ? linkedWork : null,
        pinned: Boolean(pinned),
        published: published !== false,
      });

      res.status(201).json(shapePost(post.toJSON(), []));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', requireAdmin, async (req, res, next) => {
    try {
      const updates = {};
      if (req.body?.body !== undefined) updates.body = sanitizeRichText(req.body.body);
      if (req.body?.pinned !== undefined) updates.pinned = Boolean(req.body.pinned);
      if (req.body?.published !== undefined) updates.published = Boolean(req.body.published);

      const post = await Post.findByIdAndUpdate(req.params.id, updates, { returnDocument: 'after' });
      if (!post) return res.status(404).json({ error: 'Post not found' });

      res.json(shapePost(post.toJSON(), []));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', requireAdmin, async (req, res, next) => {
    try {
      const post = await Post.findByIdAndDelete(req.params.id);
      if (!post) return res.status(404).json({ error: 'Post not found' });

      // Orphaned reactions would otherwise accumulate forever.
      await Reaction.deleteMany({ post: req.params.id });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/** Sent as a header by the client interceptor; the query fallback keeps curl usable. */
const readReactorId = (req) => {
  const value = req.get('x-reactor-id') ?? req.body?.reactorId ?? req.query.reactorId ?? '';
  const trimmed = String(value).trim();
  return trimmed.length >= 8 && trimmed.length <= 128 ? trimmed : '';
};

const countsOf = (post) => {
  const counts = post.reactionCounts instanceof Map
    ? Object.fromEntries(post.reactionCounts)
    : { ...(post.reactionCounts ?? {}) };
  // A tally can never be negative, even if a decrement raced ahead of its insert.
  return Object.fromEntries(EMOTES.map((emote) => [emote, Math.max(0, counts[emote] ?? 0)]));
};

const shapePost = (post, myEmotes) => ({
  id: String(post._id ?? post.id),
  body: post.body,
  linkedWork: post.linkedWork ?? null,
  pinned: post.pinned,
  published: post.published,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  reactionCounts: countsOf(post),
  myReactions: myEmotes,
});
