import { tintWord } from './title-tint';

describe('tintWord', () => {
  const joined = (title: string, word: string, position: number) =>
    tintWord(title, word, position)
      .map((piece) => piece.text)
      .join('');

  it('marks the chosen word and leaves the rest untinted', () => {
    const pieces = tintWord('A Red Kingdom', 'red', 0);
    expect(pieces.filter((piece) => piece.tint !== null).map((piece) => piece.text)).toEqual([
      'Red',
    ]);
  });

  it('alternates green then red down the shelf, starting green', () => {
    const tintAt = (position: number) =>
      tintWord('A Red Kingdom', 'red', position).find((piece) => piece.tint)?.tint;

    expect(tintAt(0)).toBe('green');
    expect(tintAt(1)).toBe('red');
    expect(tintAt(2)).toBe('green');
  });

  it('matches the word regardless of case', () => {
    expect(tintWord('A Heart of Flames', 'FLAMES', 0).find((piece) => piece.tint)?.text).toBe(
      'Flames',
    );
  });

  it('reassembles the title exactly, separators and all', () => {
    const title = "Uranium-235: A Sword of Memory — the author's";
    expect(joined(title, 'sword', 0)).toBe(title);
  });

  it('tints only the first occurrence', () => {
    const tinted = tintWord('Gold and Gold', 'gold', 0).filter((piece) => piece.tint);
    expect(tinted).toHaveLength(1);
  });

  it('returns the title as one untinted piece when no word is chosen', () => {
    expect(tintWord('Bells of Requiem', '', 0)).toEqual([{ text: 'Bells of Requiem', tint: null }]);
    expect(tintWord('Bells of Requiem', '   ', 0)).toEqual([
      { text: 'Bells of Requiem', tint: null },
    ]);
  });

  it('renders untinted when the chosen word is not in the title', () => {
    const pieces = tintWord('Bells of Requiem', 'carnage', 0);
    expect(pieces.every((piece) => piece.tint === null)).toBe(true);
    expect(joined('Bells of Requiem', 'carnage', 0)).toBe('Bells of Requiem');
  });

  it('does not tint a word that is only part of a longer one', () => {
    expect(tintWord('Kingdoms', 'king', 0).every((piece) => piece.tint === null)).toBe(true);
  });

  it('keeps an apostrophe inside the word it belongs to', () => {
    expect(tintWord("A Lost Man's Words", "man's", 0).find((piece) => piece.tint)?.text).toBe(
      "Man's",
    );
  });
});
