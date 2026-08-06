import { youTubeId } from './youtube';

describe('youTubeId', () => {
  const ID = 'dQw4w9WgXcQ';

  it('accepts a bare eleven-character id', () => {
    expect(youTubeId(ID)).toBe(ID);
  });

  it('reads the id out of every shape YouTube hands out', () => {
    expect(youTubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youTubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(youTubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(youTubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(youTubeId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
  });

  it('finds v= even when other parameters come first', () => {
    expect(youTubeId(`https://www.youtube.com/watch?list=PL123&v=${ID}&t=42`)).toBe(ID);
  });

  it('ignores surrounding whitespace', () => {
    expect(youTubeId(`  ${ID}  `)).toBe(ID);
  });

  it('returns null for anything that is not a video reference', () => {
    expect(youTubeId('')).toBeNull();
    expect(youTubeId('https://example.com/watch?v=nope')).toBeNull();
    expect(youTubeId('https://vimeo.com/123456')).toBeNull();
  });

  it('returns null for an id of the wrong length', () => {
    expect(youTubeId('short')).toBeNull();
    expect(youTubeId('waytoolongforanid')).toBeNull();
  });
});
