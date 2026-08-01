import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { forkJoin, map, switchMap } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ContentService } from '../../core/content.service';
import { SyncService } from '../../core/sync.service';
import { DialogueLine, Page, Section, Work } from '../../core/models';
import { TitlePiece, tintWord } from '../../shared/title-tint';
import { RefreshPillComponent } from '../../shared/refresh-pill/refresh-pill';

interface Group {
  key: string;
  label: string;
  note: string;
  works: Work[];
}

/**
 * Sub-collections per section. These are structural — they decide how works are
 * grouped, not what the page says — so they stay in code while all page copy
 * (headings, ledes, dialogue) comes from MongoDB.
 */
const SECTION_GROUPS: Record<Section, { key: string; label: string; note: string }[]> = {
  novels: [{ key: 'uranium-235', label: 'uranium-235', note: 'The series entire' }],
  poems: [
    { key: 'rains-of-love', label: 'Rains of Love', note: 'Written for her' },
    { key: 'others', label: 'Others', note: 'Everything else' },
  ],
  songs: [
    { key: 'kk', label: 'KK', note: 'For the voice that started it' },
    { key: 'others', label: 'Others', note: 'Covers and originals' },
  ],
  plays: [{ key: 'others', label: 'For the stage', note: '' }],
  novelettes: [{ key: 'others', label: 'The novelettes', note: '' }],
};

@Component({
  selector: 'app-shelf',
  imports: [RouterLink, FormsModule, RefreshPillComponent],
  templateUrl: './shelf.html',
  styleUrl: './shelf.scss',
})
export class ShelfComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly content = inject(ContentService);
  protected readonly auth = inject(AuthService);
  protected readonly sync = inject(SyncService);

  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly works = signal<Work[]>([]);
  protected readonly page = signal<Page | null>(null);

  protected readonly savingPage = signal(false);
  protected readonly draftTitle = signal('');
  protected readonly draftSubtitle = signal('');
  protected readonly draftDialogue = signal<DialogueLine[]>([]);
  protected readonly draftDialogueSource = signal('');

  /** Read from route data, so all five sections share this one component. */
  protected readonly section = toSignal(
    this.route.data.pipe(map((data) => data['section'] as Section)),
    { requireSync: true },
  );

  protected readonly editing = computed(() => this.auth.isAdmin() && this.auth.editMode());

  /** The tint belongs to the Uranium-235 books and nowhere else. */
  protected readonly tintsTitles = computed(() => this.section() === 'novels');

  protected readonly groupConfig = computed(() => SECTION_GROUPS[this.section()]);

  /** Only groups that actually contain something are rendered. */
  protected readonly groups = computed<Group[]>(() =>
    this.groupConfig()
      .map((group) => ({
        ...group,
        works: this.works().filter((work) => work.collectionKey === group.key),
      }))
      .filter((group) => group.works.length > 0),
  );

  /**
   * Anything whose collectionKey does not match a configured group still needs a
   * home, otherwise a work the author re-files would silently vanish from the site.
   */
  protected readonly ungrouped = computed(() => {
    const known = new Set(this.groupConfig().map((group) => group.key));
    return this.works().filter((work) => !known.has(work.collectionKey));
  });

  protected readonly pageDirty = computed(() => {
    const page = this.page();
    if (!page) return false;

    return (
      this.draftTitle() !== page.title ||
      this.draftSubtitle() !== page.subtitle ||
      this.draftDialogueSource() !== page.dialogueSource ||
      JSON.stringify(this.draftDialogue()) !== JSON.stringify(page.dialogue ?? [])
    );
  });

  constructor() {
    this.route.data
      .pipe(
        switchMap((data) => {
          const section = data['section'] as Section;
          this.loading.set(true);
          this.sync.watch({ page: section, works: true });

          return forkJoin({
            works: this.content.listWorks(section),
            page: this.content.getPage(section),
          });
        }),
      )
      .subscribe({
        next: ({ works, page }) => {
          this.works.set(works.works);
          this.applyPage(page);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('That shelf could not be loaded.');
          this.loading.set(false);
        },
      });
  }

  protected refresh(): void {
    const section = this.section();
    this.refreshing.set(true);

    forkJoin({
      works: this.content.listWorks(section),
      page: this.content.getPage(section),
    }).subscribe({
      next: ({ works, page }) => {
        this.works.set(works.works);
        this.applyPage(page);
        this.refreshing.set(false);
        this.sync.acknowledge();
      },
      error: () => this.refreshing.set(false),
    });
  }

  /**
   * The card shows the book alone — "Gates of Infinity", not
   * "Uranium-235: Gates of Infinity". The series is already named by the group
   * heading above the grid, so repeating it on all sixteen cards is noise.
   */
  protected bookName(work: Work): string {
    const [, book] = work.title.split(/:\s*/, 2);
    return book?.trim() || work.title;
  }

  /**
   * One tinted word per card — the one chosen for that book — with the colour
   * alternating down the shelf, starting green.
   */
  protected tinted(work: Work, position: number): TitlePiece[] {
    return tintWord(this.bookName(work), work.tintWord ?? '', position);
  }

  /** True for the one group whose label carries the series treatment. */
  protected isSeriesLabel(key: string): boolean {
    return key === 'uranium-235';
  }

  /**
   * Splits a dialogue line so the series number can be tinted inside running prose.
   * Matching is case-insensitive and covers both spellings the author uses.
   */
  protected lineParts(line: string): { text: string; mark: boolean }[] {
    return line
      .split(/(two-thirty five|235)/gi)
      .filter(Boolean)
      .map((text) => ({ text, mark: /^(two-thirty five|235)$/i.test(text) }));
  }

  // ── Page copy ──────────────────────────────────────────────────────────────

  protected savePage(): void {
    if (this.savingPage() || !this.pageDirty()) return;

    this.savingPage.set(true);
    this.content
      .savePage(this.section(), {
        title: this.draftTitle().trim(),
        subtitle: this.draftSubtitle().trim(),
        dialogue: this.draftDialogue(),
        dialogueSource: this.draftDialogueSource().trim(),
      })
      .subscribe({
        next: (page) => {
          this.applyPage(page);
          this.savingPage.set(false);
          this.sync.acknowledge();
        },
        error: () => {
          this.error.set('Those changes were not saved.');
          this.savingPage.set(false);
        },
      });
  }

  protected discardPage(): void {
    const page = this.page();
    if (page) this.applyPage(page);
  }

  protected updateDialogue(index: number, field: 'speaker' | 'line', value: string): void {
    this.draftDialogue.update((lines) =>
      lines.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  }

  protected addDialogueLine(): void {
    this.draftDialogue.update((lines) => [...lines, { speaker: '', line: '' }]);
  }

  protected removeDialogueLine(index: number): void {
    this.draftDialogue.update((lines) => lines.filter((_, i) => i !== index));
  }

  private applyPage(page: Page): void {
    this.page.set(page);
    this.draftTitle.set(page.title ?? '');
    this.draftSubtitle.set(page.subtitle ?? '');
    // Cloned so editing a row does not mutate the loaded page.
    this.draftDialogue.set((page.dialogue ?? []).map((entry) => ({ ...entry })));
    this.draftDialogueSource.set(page.dialogueSource ?? '');
  }
}
