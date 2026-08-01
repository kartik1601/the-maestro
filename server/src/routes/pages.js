import { Router } from 'express';
import { Page } from '../models/page.js';
import { attachAdmin, requireAdmin } from '../middleware/auth.js';
import { sanitizeRichText } from '../lib/sanitize.js';

/** Every page's editable copy: headings, verse, dialogue, profile, prose. */
export function pagesRouter() {
  const router = Router();

  router.get('/:slug', attachAdmin, async (req, res, next) => {
    try {
      const page = await Page.findOne({ slug: req.params.slug.toLowerCase() });
      if (!page || (!page.published && !req.admin)) {
        return res.status(404).json({ error: 'Page not found' });
      }
      res.json(page.toJSON());
    } catch (error) {
      next(error);
    }
  });

  router.put('/:slug', requireAdmin, async (req, res, next) => {
    try {
      const page = await Page.findOneAndUpdate(
        { slug: req.params.slug.toLowerCase() },
        { slug: req.params.slug.toLowerCase(), ...readPagePayload(req.body ?? {}) },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
      );

      res.json(page.toJSON());
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * Only the fields actually present in the request are written, so a page editor that
 * touches one heading cannot blank out the verse it never sent.
 */
function readPagePayload(body) {
  const payload = {};

  if (body.title !== undefined) payload.title = String(body.title).trim();
  if (body.subtitle !== undefined) payload.subtitle = String(body.subtitle).trim();
  if (body.body !== undefined) payload.body = sanitizeRichText(body.body);
  if (body.published !== undefined) payload.published = Boolean(body.published);

  if (body.verse !== undefined) {
    payload.verse = toLines(body.verse);
  }
  if (body.verseSource !== undefined) {
    payload.verseSource = String(body.verseSource).trim();
  }

  if (body.dialogue !== undefined) {
    payload.dialogue = (Array.isArray(body.dialogue) ? body.dialogue : [])
      .map((entry) => ({
        speaker: String(entry?.speaker ?? '').trim().slice(0, 80),
        line: String(entry?.line ?? '').trim().slice(0, 2000),
      }))
      // An exchange with neither a speaker nor a line is just an empty row.
      .filter((entry) => entry.speaker || entry.line);
  }
  if (body.dialogueSource !== undefined) {
    payload.dialogueSource = String(body.dialogueSource).trim();
  }

  if (body.profile !== undefined) payload.profile = readProfile(body.profile);

  return payload;
}

/** Accepts either an array of lines or one newline-separated string. */
function toLines(value) {
  const lines = Array.isArray(value) ? value : String(value ?? '').split('\n');
  return lines.map((line) => String(line).trim()).filter(Boolean).slice(0, 24);
}

/**
 * The photo is stored as a URL rather than a second copy of the bytes — the image
 * itself already lives in the media collection, uploaded through /api/media.
 */
function readProfile(profile) {
  const parsedDate = profile?.bornOn ? new Date(profile.bornOn) : null;

  return {
    photoUrl: String(profile?.photoUrl ?? '').slice(0, 500),
    bornOn: parsedDate && !Number.isNaN(parsedDate.valueOf()) ? parsedDate : null,
    profession: String(profile?.profession ?? '').trim().slice(0, 120),
    personality: String(profile?.personality ?? '').trim().slice(0, 60),
  };
}
