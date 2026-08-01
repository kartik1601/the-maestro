/**
 * The author's planned catalogue, transcribed from claude.md.
 *
 * Titles are kept verbatim — including "COLUN", which appears twice and may be
 * intentional worldbuilding rather than a typo. Change it here if it is not.
 *
 * Prose bodies below are placeholder text written for layout review only. They are
 * meant to be replaced by the author through the in-page editor.
 */

/**
 * The series, with the word in each title that takes the tint on the shelf. The picks
 * are the author's and follow each title's meaning rather than its structure, which is
 * why they are listed rather than derived.
 */
export const NOVELS = [
  { title: 'Gates of Infinity', tintWord: 'Infinity' },
  { title: 'Bells of Requiem', tintWord: 'Requiem' },
  { title: 'A Colun of Fire', tintWord: 'Fire' },
  { title: 'A Paradigm of Solace', tintWord: 'Solace' },
  { title: 'A Paradigm of Deceit', tintWord: 'Deceit' },
  { title: 'A Red Kingdom', tintWord: 'Red' },
  { title: 'To Emperor of Shadows', tintWord: 'Emperor' },
  { title: 'To Hails of Steel', tintWord: 'Steel' },
  { title: 'To Valleys of Death', tintWord: 'Valleys' },
  { title: 'To Songs of Parting', tintWord: 'Parting' },
  { title: 'Fields of Carnage', tintWord: 'Carnage' },
  { title: 'A Heart of Flames', tintWord: 'Flames' },
  { title: 'A Hand of Gold', tintWord: 'Hand' },
  { title: 'Of Colun Blue', tintWord: 'Blue' },
  { title: 'A Sword of Memory', tintWord: 'Memory' },
  { title: 'A Valley of Ashes', tintWord: 'Ashes' },
];

export const NOVELETTES = [
  'A Three-Pointed Broken Star',
  'Two Words of Freedom',
  'Morkan',
  'The Mighty Bellore',
  // Pinned to the top of its section per the spec.
  'Last Words of a Lost Man',
];

export const PLAYS = [
  'Seven Lies of Zennett',
  'The Forsaken, the Forgiven, the Forgotten',
  'A Metal King',
];

const placeholder = (title, note) => `
  <p><em>${note}</em></p>
  <p>This page is a placeholder so the layout can be reviewed before the real
  words arrive. Everything here — the type, the measure, the spacing between
  stanzas — is what "${title}" will wear when it is written.</p>
  <p>Open the editor and replace this text. It will never be shown to a reader
  once the page is published with real content.</p>
`.trim();

export const POEMS = [
  {
    title: 'The First Second',
    collectionKey: 'rains-of-love',
    subtitle: 'Rains of Love · I',
    body: `
      <p>She stood at a distance the length of a lifetime,<br />
      and the world took one step back to let me look.</p>
      <p>I have spent every year since<br />
      trying to write down what those seconds already knew.</p>
      <p><em>Placeholder verse — replace through the editor.</em></p>
    `.trim(),
  },
  {
    title: 'Letters in a Thousand Languages',
    collectionKey: 'rains-of-love',
    subtitle: 'Rains of Love · II',
    body: placeholder('Letters in a Thousand Languages', 'Rains of Love, second movement.'),
  },
  {
    title: 'Monsoon, Unanswered',
    collectionKey: 'rains-of-love',
    subtitle: 'Rains of Love · III',
    body: placeholder('Monsoon, Unanswered', 'Rains of Love, third movement.'),
  },
  {
    title: 'People Who Stay',
    collectionKey: 'others',
    subtitle: 'On the ones who arrive and remain',
    body: placeholder('People Who Stay', 'From the Others collection.'),
  },
  {
    title: 'A Lesson for a Lifetime',
    collectionKey: 'others',
    subtitle: 'On the ones who pass through',
    body: placeholder('A Lesson for a Lifetime', 'From the Others collection.'),
  },
  {
    title: 'Consciousness, and Who Taught Me the Word',
    collectionKey: 'others',
    subtitle: 'On thinking too much, and why',
    body: placeholder('Consciousness, and Who Taught Me the Word', 'From the Others collection.'),
  },
];

export const SONGS = [
  {
    title: 'Notes on Singing KK',
    collectionKey: 'kk',
    subtitle: 'Why this voice, and no other',
    body: `
      <p>Some voices do not age with you — they wait for you to catch up to them.</p>
      <p><em>Placeholder note. Write here about what these songs meant, and record
      the covers separately; this page holds the words around the music, not the
      lyrics themselves.</em></p>
    `.trim(),
  },
  {
    title: 'Cover · Untitled I',
    collectionKey: 'kk',
    subtitle: 'A cover, and the evening it belongs to',
    body: placeholder('Cover · Untitled I', 'KK collection — replace with your own notes.'),
  },
  {
    title: 'An Empty Vessel Running on Biological Mechanics',
    collectionKey: 'others',
    subtitle: 'On days without songs',
    body: placeholder('An Empty Vessel Running on Biological Mechanics', 'From the Others collection.'),
  },
  {
    title: 'Written While the Record Played',
    collectionKey: 'others',
    subtitle: 'Original · lyrics and a melody line',
    body: placeholder('Written While the Record Played', 'From the Others collection.'),
  },
];

/**
 * The copy for every page, seeded into MongoDB so the author can rewrite any of it
 * in place. Nothing visible on the site is hardcoded in the client.
 */
export const SECTION_PAGES = [
  {
    slug: 'blogs',
    title: '',
    subtitle: 'The next verses shall remain as a testament of my living and the dead memoirs.',
    verse: ['What is Love?', "If it's not for you,", 'Only you.'],
    verseSource: 'Last Words of a Lost Man',
  },
  {
    slug: 'novels',
    title: 'Novels',
    subtitle: 'One series, sixteen books.',
    dialogue: [
      { speaker: 'Professor', line: 'Why two-thirty five?' },
      { speaker: 'The Man', line: "I didn't know it existed." },
      { speaker: 'Professor', line: 'What? How?' },
      {
        speaker: 'The Man',
        line: 'I was limited to the information around me. It took me a week. But during that time, I was "someone" questioning an anomaly of this universe, and a two-thirty five colors blocked my eyes from finding the truth.',
      },
    ],
    dialogueSource: 'Last Words of a Lost Man',
  },
  {
    slug: 'poems',
    title: 'Poems',
    subtitle:
      'Some of these were written for one person. The rest were written because of everyone else.',
  },
  {
    slug: 'songs',
    title: 'Songs',
    subtitle: 'Without songs the day is an empty vessel running on biological mechanics.',
  },
  {
    slug: 'plays',
    title: 'Plays',
    subtitle: 'Written to be spoken aloud, and to be heard in a room.',
  },
  {
    slug: 'novelettes',
    title: 'Novelettes',
    subtitle: 'Shorter than the novels, and heavier for it.',
  },
];

/**
 * Placeholder scaffolding for a fresh database, not anybody's actual details.
 *
 * The real name, date of birth, portrait and biography live in MongoDB, written by
 * the author through the in-page editor. They are kept out of this file on purpose:
 * the repository is public, git history is permanent, and a full name beside an exact
 * date of birth is the pair used to verify an identity. Anything typed here would
 * outlive every later edit.
 *
 * The seeder only writes these to a page nobody has edited, so filling them in on a
 * live site is safe — see seedPage().
 */
export const ABOUT_PAGE = {
  slug: 'about-the-author',
  title: 'The Author',
  subtitle: 'A line about who is writing all this',
  profile: {
    photoUrl: '',
    bornOn: null,
    profession: '',
    personality: '',
  },
  body: `
    <p>This page is waiting to be written. Sign in, switch to editing, and replace
    everything here with your own words — who you are, what made you start writing,
    and what keeps you at it.</p>
    <p>The portrait, the date of birth and the details beside it are editable on this
    same page. Nothing on it is fixed by the code.</p>
  `.trim(),
};

export const POSTS = [
  {
    body: `<p>The archive is open. Everything I have written, and everything I am still
      writing, will live here — free, for anyone who wants to read it.</p>`,
    pinned: true,
  },
  {
    body: `<p><strong>Uranium-235</strong> is sixteen books. I have known that number for
      a long time. Today the shelf for them finally exists.</p>`,
  },
  {
    body: `<p>Wrote most of tonight with one song on repeat. Some days the words arrive
      only after the music has gone ahead of them.</p>`,
  },
];
