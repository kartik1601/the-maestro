import mongoose from 'mongoose';
import { Work } from '../models/work.js';
import { Page } from '../models/page.js';
import { Post } from '../models/post.js';
import { slugify } from '../lib/slugify.js';
import { excerptFrom, readingMinutes, sanitizeRichText } from '../lib/sanitize.js';
import {
  ABOUT_PAGE,
  NOVELETTES,
  NOVELS,
  PLAYS,
  POEMS,
  POSTS,
  SECTION_PAGES,
  SONGS,
} from './content.js';

/**
 * Idempotent: every write is an upsert keyed on (section, slug), so running this
 * against a database that already holds the author's real work adds the missing
 * catalogue entries without touching what is already there.
 */
export async function seedDatabase({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;

  const existing = await Work.estimatedDocumentCount();
  if (existing > 0) {
    log('[seed] works already present — filling gaps only.');
  }

  const novels = NOVELS.map(({ title, tintWord }, index) => ({
    section: 'novels',
    kind: 'upload',
    title: `Uranium-235: ${title}`,
    slug: slugify(`uranium-235 ${title}`),
    // No subtitle — the volume name is already carried by the title.
    subtitle: '',
    tintWord,
    collectionKey: 'uranium-235',
    seriesNumber: index + 1,
    summary: `Book ${index + 1} of the Uranium-235 series.`,
    // Published so the full shelf is visible as a statement of intent. Each card
    // shows an "awaiting upload" state until its PDF arrives.
    published: true,
    publishedAt: new Date(),
  }));

  const novelettes = NOVELETTES.map((title, index) => ({
    section: 'novelettes',
    kind: 'upload',
    title,
    slug: slugify(title),
    collectionKey: 'others',
    sortOrder: index,
    pinned: title === 'Last Words of a Lost Man',
    published: true,
    publishedAt: new Date(),
  }));

  const plays = PLAYS.map((title, index) => ({
    section: 'plays',
    kind: 'upload',
    title,
    slug: slugify(title),
    collectionKey: 'others',
    sortOrder: index,
    published: true,
    publishedAt: new Date(),
  }));

  const documents = [
    ...POEMS.map((poem, index) => ({ ...poem, section: 'poems', sortOrder: index })),
    ...SONGS.map((song, index) => ({ ...song, section: 'songs', sortOrder: index })),
  ].map((item) => {
    const body = sanitizeRichText(item.body);
    return {
      section: item.section,
      kind: 'document',
      title: item.title,
      slug: slugify(item.title),
      subtitle: item.subtitle ?? '',
      collectionKey: item.collectionKey,
      sortOrder: item.sortOrder,
      body,
      excerpt: excerptFrom(body),
      readingMinutes: readingMinutes(body),
      // Editable pages ship visible so every section has something to look at.
      published: true,
      publishedAt: new Date(),
    };
  });

  const all = [...novels, ...novelettes, ...plays, ...documents];

  await Work.bulkWrite(
    all.map((work) => ({
      updateOne: {
        filter: { section: work.section, slug: work.slug },
        update: { $setOnInsert: work },
        upsert: true,
      },
    })),
  );

  /**
   * `$setOnInsert` above never reaches works that already exist, so a field added to
   * the template later has to be backfilled. Only rows that have not got one are
   * touched, which leaves any pick the author has since changed alone.
   */
  const backfill = await Work.bulkWrite(
    novels.map((work) => ({
      updateOne: {
        filter: { section: 'novels', slug: work.slug, tintWord: { $in: [null, ''] } },
        update: { $set: { tintWord: work.tintWord } },
      },
    })),
  );
  if (backfill.modifiedCount > 0) {
    log(`[seed] backfilled tintWord on ${backfill.modifiedCount} novels.`);
  }

  await seedPage({ ...ABOUT_PAGE, body: sanitizeRichText(ABOUT_PAGE.body) }, log);
  for (const page of SECTION_PAGES) {
    await seedPage(page, log);
  }

  if ((await Post.estimatedDocumentCount()) === 0) {
    await Post.insertMany(
      POSTS.map((post) => ({ ...post, body: sanitizeRichText(post.body), published: true })),
    );
  }

  log(`[seed] catalogue ready — ${all.length} works, 1 page, ${POSTS.length} posts.`);
}

/**
 * A page is seeded content until the author touches it, and their words must never be
 * overwritten by a later change to the template.
 *
 * Editedness is decided by comparing against the stored snapshot, not by timestamps:
 * Mongoose stamps `updatedAt` on every `updateOne`, so the seeder's own upserts would
 * make an untouched page look edited within one boot.
 */
async function seedPage(template, log) {
  const snapshot = snapshotOf(template);
  const existing = await Page.findOne({ slug: template.slug });

  if (!existing) {
    await Page.create({ ...template, seedSnapshot: snapshot });
    log(`[seed] page '${template.slug}' created.`);
    return;
  }

  /**
   * No snapshot means the page predates this mechanism. Those are treated as
   * unedited — correct for every such page in this project, none of which the author
   * has written to — and the ambiguity disappears after one run.
   */
  const untouched = !existing.seedSnapshot || matchesSnapshot(existing, existing.seedSnapshot);

  if (!untouched) {
    log(`[seed] page '${template.slug}' has been edited — left untouched.`);
    return;
  }

  existing.set({ ...template, seedSnapshot: snapshot });
  await existing.save();
  log(`[seed] page '${template.slug}' refreshed from the template.`);
}

/** The seeder-managed fields, normalized so stored and template values compare equal. */
function snapshotOf(page) {
  const profile = page.profile ?? {};

  return {
    title: page.title ?? '',
    subtitle: page.subtitle ?? '',
    body: page.body ?? '',
    verse: [...(page.verse ?? [])],
    verseSource: page.verseSource ?? '',
    dialogue: (page.dialogue ?? []).map((entry) => ({
      speaker: entry.speaker ?? '',
      line: entry.line ?? '',
    })),
    dialogueSource: page.dialogueSource ?? '',
    profile: {
      photoUrl: profile.photoUrl ?? '',
      bornOn: profile.bornOn ? new Date(profile.bornOn).toISOString() : '',
      profession: profile.profession ?? '',
      personality: profile.personality ?? '',
    },
  };
}

/**
 * Compares only the keys the snapshot actually carries. A template that later gains
 * a field therefore does not invalidate snapshots written before it existed.
 */
function matchesSnapshot(page, snapshot) {
  const current = snapshotOf(page);

  return Object.keys(snapshot).every(
    (key) => JSON.stringify(current[key]) === JSON.stringify(snapshot[key]),
  );
}

// Allow `npm run seed` to run this file directly against a configured database.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { connectDatabase, disconnectDatabase } = await import('../db/connect.js');
  const { mode } = await connectDatabase();

  if (mode === 'in-memory') {
    console.warn('[seed] No MONGODB_URI set — seeding a throwaway database. Nothing will persist.');
  }

  await seedDatabase();
  await disconnectDatabase();
  await mongoose.disconnect();
}
