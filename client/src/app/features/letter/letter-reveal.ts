import { Component, DestroyRef, computed, inject, output, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { LetterService } from '../../core/letter.service';

type Phase = 'loading' | 'names' | 'video';

/** Before the first name rolls in, while "Hi!" settles. */
const LEAD_IN_MS = 1300;
/**
 * How long each name stays before the next is dialled. Counted from when the reels
 * start turning, so each includes the roll itself — about two seconds, plus a little
 * for every reel further along (see `.reel__strip` in the stylesheet).
 */
const HOLD_FIRST_MS = 4800;
const HOLD_MS = 3800;
const HOLD_LAST_MS = 5600;

const FONT_FAMILY = 'Playfair Display';
const FONT_WEIGHT = 400;

/**
 * Loaded only here, only after the answers were right — the rest of the site keeps
 * its system fonts and renders the same with no network. Without it the stack falls
 * back to the site's own serif.
 */
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&display=swap';

/**
 * What a reel can show, in the order it rolls through them — the way a suitcase lock
 * clicks past every digit between where it is and where it is going. The blank comes
 * first so an unused reel rests empty, and any character a name needs that is not
 * listed here is appended.
 */
const ALPHABET = [' ', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-'];

/**
 * What opens once the gate does: a beige page, "Hi!", and her name dialled in on a
 * row of letter reels, then re-dialled through every name it has been. Only the reels
 * whose letter changes turn; the rest hold still.
 *
 * The names come from the server, never from this bundle: the bundle is public.
 */
@Component({
  selector: 'app-letter-reveal',
  templateUrl: './letter-reveal.html',
  styleUrl: './letter-reveal.scss',
})
export class LetterRevealComponent {
  private readonly letter = inject(LetterService);
  private readonly document = inject(DOCUMENT);

  readonly closed = output<void>();

  protected readonly phase = signal<Phase>('loading');
  /** Where the film is served from, once the server says there is one. */
  protected readonly videoSrc = signal<string | null>(null);
  /** Replay waits until the film has played through. */
  protected readonly ended = signal(false);
  private readonly greetings = signal<string[]>([]);
  /** -1 until the first name is dialled in: every reel starts blank. */
  private readonly index = signal(-1);

  /** Character widths in em, measured in the real font so a blank reel takes no room. */
  private readonly widths = signal<Map<string, number>>(new Map());

  protected readonly strip = computed(() => {
    const extra = new Set(this.greetings().join(''));
    ALPHABET.forEach((char) => extra.delete(char));
    return [...ALPHABET, ...extra];
  });

  protected readonly reels = computed(() => {
    const names = this.greetings();
    const strip = this.strip();
    const count = Math.max(0, ...names.map((name) => [...name].length));
    const current = [...(names[this.index()] ?? '')];
    const widths = this.widths();

    return Array.from({ length: count }, (_, column) => {
      const char = current[column] ?? ' ';
      return {
        column,
        position: Math.max(0, strip.indexOf(char)),
        width: char === ' ' ? 0 : (widths.get(char) ?? 0.5),
      };
    });
  });

  /** The name as text, for screen readers — the reels themselves are decoration. */
  protected readonly spoken = computed(() => this.greetings()[this.index()] ?? '');

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const body = this.document.body;
    const overflow = body.style.overflow;
    body.style.overflow = 'hidden';
    this.loadFont();

    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      body.style.overflow = overflow;
    });

    this.letter.content().subscribe({
      next: async ({ greetings, video }) => {
        if (video) this.videoSrc.set(this.letter.videoUrl(video.token, this.quality()));
        if (!greetings.length) return this.phase.set('video');

        this.greetings.set(greetings);
        await this.measure();
        this.phase.set('names');
        this.timer = setTimeout(() => this.advance(), LEAD_IN_MS);
      },
      // The token lapsed or the letter was taken down: nothing to show.
      error: () => this.closed.emit(),
    });
  }

  /** From the top: every reel back to blank, then the names again. */
  protected replay(): void {
    clearTimeout(this.timer);
    this.ended.set(false);
    this.index.set(-1);
    this.phase.set('names');
    this.timer = setTimeout(() => this.advance(), LEAD_IN_MS);
  }

  private advance(): void {
    const next = this.index() + 1;
    const last = this.greetings().length - 1;
    if (next > last) return this.phase.set('video');

    this.index.set(next);
    const hold = next === 0 ? HOLD_FIRST_MS : next === last ? HOLD_LAST_MS : HOLD_MS;
    this.timer = setTimeout(() => this.advance(), hold);
  }

  /** The 720p cut on a phone-sized screen or when the reader has asked to save data. */
  private quality(): 'hd' | 'sd' {
    const view = this.document.defaultView;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    return saveData || view?.matchMedia('(max-width: 900px)').matches ? 'sd' : 'hd';
  }

  /**
   * Widths come from the font itself, once it has loaded, so each reel can narrow or
   * widen to its letter and the "." after the name travels with it.
   */
  private async measure(): Promise<void> {
    const size = 100;
    const font = `${FONT_WEIGHT} ${size}px "${FONT_FAMILY}"`;
    try {
      await Promise.race([
        this.document.fonts.load(font),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch {
      // Measured in the fallback serif instead.
    }

    const context = this.document.createElement('canvas').getContext('2d');
    if (!context) return;
    context.font = `${font}, Georgia, serif`;

    this.widths.set(
      new Map(this.strip().map((char) => [char, context.measureText(char).width / size])),
    );
  }

  private loadFont(): void {
    if (this.document.querySelector(`link[href="${FONT_HREF}"]`)) return;
    const link = this.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    this.document.head.appendChild(link);
  }
}
