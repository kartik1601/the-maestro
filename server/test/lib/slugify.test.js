import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { slugify } from '../../src/lib/slugify.js';

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    assert.equal(slugify('Gates of Infinity'), 'gates-of-infinity');
  });

  it('keeps digits, so the series number survives', () => {
    assert.equal(slugify('URANIUM-235: A Red Kingdom'), 'uranium-235-a-red-kingdom');
  });

  it('folds accents rather than dropping the letter', () => {
    assert.equal(slugify('Bellorè'), 'bellore');
    assert.equal(slugify('Bellore'), slugify('Bellorè'));
  });

  it('drops apostrophes instead of turning them into separators', () => {
    assert.equal(slugify("Last Words of a Lost Man's"), 'last-words-of-a-lost-mans');
    assert.equal(slugify('Last Words of a Lost Man’s'), 'last-words-of-a-lost-mans');
  });

  it('collapses runs of punctuation into a single hyphen', () => {
    assert.equal(slugify('A -- B ... C'), 'a-b-c');
  });

  it('trims leading and trailing hyphens', () => {
    assert.equal(slugify('  ...Requiem!  '), 'requiem');
  });

  it('caps the length so a title cannot produce an unusable URL', () => {
    assert.equal(slugify('a'.repeat(200)).length, 96);
  });

  it('returns an empty string for nothing at all', () => {
    assert.equal(slugify(''), '');
    assert.equal(slugify(null), '');
    assert.equal(slugify(undefined), '');
    assert.equal(slugify('!!!'), '');
  });

  it('is stable — slugifying a slug changes nothing', () => {
    const once = slugify('URANIUM-235: Bells of Requiem');
    assert.equal(slugify(once), once);
  });
});
