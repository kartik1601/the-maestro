export interface TitlePiece {
  text: string;
  /** Null for the untinted remainder of the title. */
  tint: 'green' | 'red' | null;
}

/**
 * Tints one named word of a title, alternating the colour from card to card starting
 * green — so the first book's word is green, the second's red, the third green again.
 *
 * The word to mark is chosen per book by the author and travels with the work, since
 * the picks follow each title's meaning rather than its structure ("A **Red** Kingdom"
 * but "A Heart of **Flames**") and no rule reproduces them.
 *
 * `position` is the card's index within its group, not a global counter, so every
 * shelf begins on green. A title with no chosen word, or whose word is not present,
 * simply renders untinted.
 */
export function tintWord(title: string, word: string, position: number): TitlePiece[] {
  const target = word.trim().toLowerCase();
  if (!target) return [{ text: title, tint: null }];

  const tint: TitlePiece['tint'] = position % 2 === 0 ? 'green' : 'red';
  const pieces: TitlePiece[] = [];
  let tinted = false;

  // Split on separators but keep them, so the title reassembles exactly as written.
  for (const token of title.split(/(\s+|[^\p{L}\p{N}']+)/u).filter(Boolean)) {
    const isMatch = !tinted && token.toLowerCase() === target;
    pieces.push({ text: token, tint: isMatch ? tint : null });
    if (isMatch) tinted = true;
  }

  return pieces;
}
