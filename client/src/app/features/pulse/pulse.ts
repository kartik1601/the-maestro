import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { ContentService } from '../../core/content.service';
import { SECTION_META, Section } from '../../core/models';
import {
  LetterEventKind,
  LetterHeld,
  LetterOverview,
  Pulse,
  PulseLink,
  PulseRange,
  PulseService,
} from '../../core/pulse.service';
import { ModalService } from '../../shared/modal/modal.service';

const REFRESH_MS = 10_000;

const LETTER_EVENT_LABELS: Record<LetterEventKind, string> = {
  unlocked: 'Opened the message',
  wrong: 'Wrong details',
  blocked: 'Blocked for a day',
  'otp-requested': 'Asked for a code',
  'otp-accepted': 'Used the code',
  'otp-wrong': 'Wrong code',
  unblocked: 'Released by you',
};

const LETTER_HELD_LABELS: Record<LetterHeld['state'], string> = {
  open: 'Free to try',
  email: 'Waiting',
  otp: 'Code sent',
  cooldown: 'Waiting',
  blocked: 'Blocked',
};

const RANGES: { key: PulseRange; label: string; phrase: string }[] = [
  { key: 'today', label: 'Today', phrase: 'today' },
  { key: '7d', label: '7 days', phrase: 'last 7 days' },
  { key: '30d', label: '30 days', phrase: 'last 30 days' },
  { key: 'all', label: 'All time', phrase: 'all time' },
];

/**
 * Who is reading, what they are reading, and how they found the site.
 *
 * The author's page alone: the route only matches with a session, and the API behind
 * it answers 404 without one. It refreshes itself while it is on screen and goes
 * quiet when the tab is hidden, the same way the readers' own polling does.
 */
@Component({
  selector: 'app-pulse',
  imports: [FormsModule, RouterLink],
  templateUrl: './pulse.html',
  styleUrl: './pulse.scss',
})
export class PulseComponent {
  private readonly pulse = inject(PulseService);
  private readonly content = inject(ContentService);
  private readonly modal = inject(ModalService);

  protected readonly ranges = RANGES;
  protected readonly range = signal<PulseRange>('7d');
  protected readonly data = signal<Pulse | null>(null);
  protected readonly failed = signal(false);

  protected readonly rangePhrase = computed(
    () => RANGES.find((range) => range.key === this.range())?.phrase ?? '',
  );

  protected readonly livePlaces = computed(
    () => new Set(this.data()?.live.map((reader) => reader.path)).size,
  );

  /** Bars are sized against the busiest place, so one reader is not a full bar of seven. */
  protected readonly placeMax = computed(() =>
    Math.max(1, ...(this.data()?.places.map((place) => place.count) ?? [])),
  );

  protected readonly dayMax = computed(() =>
    Math.max(1, ...(this.data()?.days.map((day) => day.views) ?? [])),
  );

  protected readonly busiest = computed(() => {
    const days = this.data()?.days ?? [];
    const top = days.reduce((best, day) => (day.views > best.views ? day : best), {
      day: '',
      views: 0,
    });
    return top.views > 0 ? top : null;
  });

  protected readonly instagramShare = computed(() => {
    const totals = this.data()?.totals;
    return totals && totals.arrivals > 0
      ? Math.round((totals.instagram / totals.arrivals) * 100)
      : null;
  });

  // ── The letter ─────────────────────────────────────────────────────────────

  protected readonly letter = signal<LetterOverview | null>(null);
  protected readonly releasing = signal<string | null>(null);
  protected readonly letterEventLabels = LETTER_EVENT_LABELS;
  protected readonly letterHeldLabels = LETTER_HELD_LABELS;

  protected async release(held: LetterHeld): Promise<void> {
    const confirmed = await this.modal.confirm({
      title: `Release ${held.ip || 'this address'}?`,
      message:
        'Its wait or block ends now and its strikes are wiped, so it gets three fresh tries.',
      confirmLabel: 'Release',
    });
    if (!confirmed) return;

    this.releasing.set(held.id);
    this.pulse.releaseLetter(held.id).subscribe({
      next: () => {
        this.releasing.set(null);
        this.refreshLetter();
      },
      error: () => this.releasing.set(null),
    });
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private refreshLetter(): void {
    this.pulse.letter().subscribe({
      next: (letter) => this.letter.set(letter),
      error: () => undefined,
    });
  }

  // ── Making a link ──────────────────────────────────────────────────────────

  protected readonly linkLabel = signal('');
  protected readonly linkPath = signal('/');
  protected readonly creating = signal(false);
  protected readonly linkError = signal<string | null>(null);
  protected readonly copiedTag = signal<string | null>(null);

  /** Everywhere a link can land: the fixed pages, then every published work. */
  protected readonly destinations = signal<{ path: string; label: string }[]>(
    SECTION_META.map((section) => ({ path: section.path, label: section.label })),
  );

  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
    document.addEventListener('visibilitychange', this.onVisibility);

    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.timer);
      document.removeEventListener('visibilitychange', this.onVisibility);
    });

    this.loadDestinations();
  }

  protected choose(range: PulseRange): void {
    this.range.set(range);
    this.refresh();
  }

  protected createLink(event: Event): void {
    event.preventDefault();
    const label = this.linkLabel().trim();
    if (!label || this.creating()) return;

    this.creating.set(true);
    this.linkError.set(null);

    this.pulse.createLink(label, this.linkPath()).subscribe({
      next: (link) => {
        this.creating.set(false);
        this.linkLabel.set('');
        this.copy(link);
        this.refresh();
      },
      error: () => {
        this.linkError.set('That link was not made.');
        this.creating.set(false);
      },
    });
  }

  protected async removeLink(link: PulseLink): Promise<void> {
    if (!link.id) return;

    const confirmed = await this.modal.confirm({
      title: 'Remove this link?',
      message: `"${link.label}" leaves this list. The link itself keeps working, and the visits it brought stay counted.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!confirmed) return;

    this.pulse.removeLink(link.id).subscribe(() => this.refresh());
  }

  protected copy(link: PulseLink): void {
    // Not every browser grants the clipboard; the address is on screen either way.
    navigator.clipboard
      ?.writeText(this.urlOf(link))
      .then(() => {
        this.copiedTag.set(link.tag);
        setTimeout(() => this.copiedTag.update((tag) => (tag === link.tag ? null : tag)), 2500);
      })
      .catch(() => undefined);
  }

  protected urlOf(link: PulseLink): string {
    return `${location.origin}${link.path || '/'}?via=${link.tag}`;
  }

  /** The same address without the scheme — what is worth reading in a narrow column. */
  protected shownUrl(link: PulseLink): string {
    return this.urlOf(link).replace(/^https?:\/\/(www\.)?/, '');
  }

  // ── Formatting ─────────────────────────────────────────────────────────────

  protected duration(seconds: number): string {
    if (seconds < 60) return `${seconds} sec`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  /** Relative to when the server answered, so a slow clock here cannot say "in 3 minutes". */
  protected ago(iso: string | null): string {
    const checkedAt = this.data()?.checkedAt;
    if (!iso || !checkedAt) return 'Never opened';

    const seconds = Math.max(0, Math.round((Date.parse(checkedAt) - Date.parse(iso)) / 1000));
    if (seconds < 60) return 'Last opened just now';
    if (seconds < 3600) return `Last opened ${Math.round(seconds / 60)} min ago`;
    if (seconds < 86_400) return `Last opened ${Math.round(seconds / 3600)} h ago`;
    return `Last opened ${Math.round(seconds / 86_400)} d ago`;
  }

  protected dayNumber(day: string): string {
    return String(Number(day.slice(8)));
  }

  protected dayName(day: string): string {
    const [year, month, date] = day.split('-').map(Number);
    return new Date(year, month - 1, date).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
  }

  protected percent(value: number, max: number): string {
    return `${Math.round((value / max) * 100)}%`;
  }

  private refresh(): void {
    if (document.hidden) return;
    this.refreshLetter();

    const asked = this.range();
    this.pulse.load(asked).subscribe({
      next: (data) => {
        // A slow answer for a range the author has since left is not worth showing.
        if (asked !== this.range()) return;
        this.data.set(data);
        this.failed.set(false);
      },
      error: () => this.failed.set(true),
    });
  }

  private loadDestinations(): void {
    const sections = SECTION_META.filter(
      (section) => section.key !== 'blogs' && section.key !== 'about',
    );

    forkJoin(
      sections.map((section) =>
        this.content
          .listWorks(section.key as Section)
          .pipe(catchError(() => of({ section: section.key as Section, works: [] }))),
      ),
    ).subscribe((shelves) => {
      const works = shelves.flatMap((shelf, index) =>
        shelf.works
          // A draft would land a reader on a page that tells them nothing is there.
          .filter((work) => work.published)
          .map((work) => ({
            path: `/${work.section}/${work.slug}`,
            label: `${sections[index].label} · ${work.title}`,
          })),
      );
      this.destinations.update((fixed) => [...fixed, ...works]);
    });
  }

  private readonly onVisibility = (): void => {
    if (!document.hidden) this.refresh();
  };
}
