import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { forkJoin, map, switchMap } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ContentService } from '../../core/content.service';
import { SyncService } from '../../core/sync.service';
import { DialogueLine, Page, Section, Work, WorkCollection } from '../../core/models';
import { ModalService } from '../../shared/modal/modal.service';
import { TitlePiece, tintWord } from '../../shared/title-tint';
import { RefreshPillComponent } from '../../shared/refresh-pill/refresh-pill';

interface Group {
  key: string;
  label: string;
  note: string;
  works: Work[];
}

/** Sections whose works are written on the page rather than uploaded as a PDF. */
const DOCUMENT_SECTIONS: Section[] = ['poems', 'songs'];

/** The phone breakpoint the shelf styles use — kept in step with shelf.scss. */
const PHONE = '(max-width: 40rem)';

@Component({
  selector: 'app-shelf',
  imports: [RouterLink, FormsModule, RefreshPillComponent, CdkDropList, CdkDrag, CdkDragHandle],
  templateUrl: './shelf.html',
  styleUrl: './shelf.scss',
})
export class ShelfComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly content = inject(ContentService);
  private readonly modal = inject(ModalService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  protected readonly sync = inject(SyncService);

  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Kept apart from `error`: a failed reorder must not take the shelf off the page. */
  protected readonly orderError = signal<string | null>(null);
  protected readonly works = signal<Work[]>([]);
  protected readonly page = signal<Page | null>(null);

  protected readonly savingPage = signal(false);
  protected readonly draftTitle = signal('');
  protected readonly draftSubtitle = signal('');
  protected readonly draftDialogue = signal<DialogueLine[]>([]);
  protected readonly draftDialogueSource = signal('');
  protected readonly draftCollections = signal<WorkCollection[]>([]);

  /** Tracks the phone width live, so a rotated tablet answers for where it is now. */
  private readonly narrow = signal(matchMedia(PHONE).matches);

  /** Which sub-sections are open. Everything starts closed — see `collapsible`. */
  private readonly expandedGroups = signal<ReadonlySet<string>>(new Set());

  /** New-work composer state, keyed by the sub-section it will be filed into. */
  protected readonly addingTo = signal<string | null>(null);
  protected readonly newWorkTitle = signal('');
  protected readonly newWorkSubtitle = signal('');
  protected readonly creating = signal(false);

  /** Read from route data, so all five sections share this one component. */
  protected readonly section = toSignal(
    this.route.data.pipe(map((data) => data['section'] as Section)),
    { requireSync: true },
  );

  protected readonly editing = computed(() => this.auth.isAdmin() && this.auth.editMode());

  /** The tint belongs to the Uranium-235 books and nowhere else. */
  protected readonly tintsTitles = computed(() => this.section() === 'novels');

  /** Sub-sections come from the page document, so the author can edit them. */
  protected readonly groupConfig = computed(() =>
    [...(this.page()?.collections ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
  );

  /**
   * Empty sub-sections stay hidden from readers but remain visible to the author —
   * otherwise a newly created one would vanish before anything could be filed into it.
   */
  protected readonly groups = computed<Group[]>(() =>
    this.groupConfig()
      .map((group) => ({
        key: group.key,
        label: group.label,
        note: group.note,
        works: this.works().filter((work) => work.collectionKey === group.key),
      }))
      .filter((group) => group.works.length > 0 || this.editing()),
  );

  protected readonly canAddWorks = computed(() => DOCUMENT_SECTIONS.includes(this.section()));

  /**
   * Poems and songs have no order of their own — no series number, no reason for
   * alphabetical — so the author places them by hand. The uploaded sections already
   * have an order that means something and are left alone.
   */
  protected readonly canReorder = computed(() => this.editing() && this.canAddWorks());

  /**
   * Poems and songs are shelves of many small things, and on a phone the grid runs to a
   * scroll long enough that the sub-section names stop being findable. There the shelf
   * arrives as those names alone and each opens on a tap. Novels, plays and novelettes
   * are short lists of large works, so they stay laid out. On any wider screen every
   * section is open and the heading is not a control.
   */
  protected readonly collapsible = computed(
    () => this.narrow() && DOCUMENT_SECTIONS.includes(this.section()),
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
      JSON.stringify(this.draftDialogue()) !== JSON.stringify(page.dialogue ?? []) ||
      JSON.stringify(this.draftCollections()) !== JSON.stringify(page.collections ?? [])
    );
  });

  constructor() {
    const phone = matchMedia(PHONE);
    const onResize = (event: MediaQueryListEvent) => this.narrow.set(event.matches);
    phone.addEventListener('change', onResize);
    this.destroyRef.onDestroy(() => phone.removeEventListener('change', onResize));

    this.route.data
      .pipe(
        switchMap((data) => {
          const section = data['section'] as Section;
          this.loading.set(true);
          this.expandedGroups.set(new Set());
          this.sync.watch({ page: section, works: section });

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

  /**
   * A song with a video is shown as that video: title, subtitle, still. Nothing else
   * is a fair summary of a song, and a clamped three lines of lyric reads as an
   * accident. Anything without a video falls back to words, as everywhere else.
   */
  protected showsVideo(work: Work): boolean {
    return this.section() === 'songs' && Boolean(work.videoId);
  }

  /** hqdefault exists for every video; maxres does not, and a 404 leaves a hole. */
  protected thumbnail(work: Work): string {
    return `https://i.ytimg.com/vi/${work.videoId}/hqdefault.jpg`;
  }

  /**
   * The excerpt of an uploaded work is its author's note, which belongs above the
   * reader rather than on the shelf — the card carries the book, not the preface.
   */
  protected showsExcerpt(work: Work): boolean {
    return work.kind !== 'upload' && Boolean(work.excerpt) && !this.showsVideo(work);
  }

  /**
   * Whether the foot of the card has anything to say. An empty one is not invisible —
   * it still claims its padding, and the still above it would sit off-centre.
   */
  protected showsMeta(work: Work): boolean {
    if (this.auth.isAdmin() && !work.published) return true;
    if (this.showsVideo(work)) return false;
    return work.kind === 'upload' || Boolean(work.readingMinutes);
  }

  // ── Collapsing ─────────────────────────────────────────────────────────────

  /** Open whenever the shelf is not collapsible, so the wide layout ignores all this. */
  protected isExpanded(key: string): boolean {
    return !this.collapsible() || this.expandedGroups().has(key);
  }

  protected toggleGroup(key: string): void {
    this.expandedGroups.update((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
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
        collections: this.draftCollections(),
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

  // ── Sub-sections ───────────────────────────────────────────────────────────

  protected updateCollection(index: number, field: 'label' | 'note', value: string): void {
    this.draftCollections.update((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  }

  protected addCollection(): void {
    this.draftCollections.update((rows) => [
      ...rows,
      {
        key: `section-${Date.now().toString(36)}`,
        label: 'New sub-section',
        note: '',
        sortOrder: rows.length,
      },
    ]);
  }

  /**
   * Removing a sub-section leaves its works behind rather than deleting them; they
   * fall through to "Unfiled", where they can be re-filed instead of disappearing.
   */
  protected async removeCollection(index: number): Promise<void> {
    const row = this.draftCollections()[index];
    const orphans = this.works().filter((work) => work.collectionKey === row.key).length;

    const confirmed = await this.modal.confirm({
      title: `Remove "${row.label}"?`,
      message: orphans
        ? `${orphans} ${orphans === 1 ? 'work moves' : 'works move'} to Unfiled. Nothing is deleted.`
        : 'This sub-section is empty.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!confirmed) return;

    this.draftCollections.update((rows) => rows.filter((_, i) => i !== index));
  }

  // ── Ordering works ─────────────────────────────────────────────────────────

  /**
   * Cards move within their own sub-section only; dragging one into another group
   * would be a re-filing, which is a different decision from placing it.
   *
   * The new order is shown at once and written behind it — the author is arranging a
   * shelf, and a card that snaps back while the request is in flight would read as the
   * drag having failed. A failed write says so and restores what the server still holds.
   */
  protected dropWork(group: Group, event: CdkDragDrop<Work[]>): void {
    if (event.previousIndex === event.currentIndex) return;

    const before = this.works();
    const ordered = [...group.works];
    moveItemInArray(ordered, event.previousIndex, event.currentIndex);

    // Spliced back over the group's own slots: `groups` filters `works` in place, so the
    // positions these cards occupy in the full list are exactly the ones they came from.
    const queue = ordered.map((work, index) => ({ ...work, sortOrder: index }));
    this.works.set(
      before.map((work) => (work.collectionKey === group.key ? queue.shift()! : work)),
    );

    this.orderError.set(null);
    this.content.reorderWorks(ordered.map((work) => work.id)).subscribe({
      next: () => this.sync.acknowledge(),
      error: () => {
        this.works.set(before);
        this.orderError.set('That order was not saved.');
      },
    });
  }

  // ── Adding works ───────────────────────────────────────────────────────────

  protected startAdding(collectionKey: string): void {
    // The composer lives inside the panel, so a collapsed sub-section has to open with it.
    this.expandedGroups.update((open) => new Set(open).add(collectionKey));
    this.addingTo.set(collectionKey);
    this.newWorkTitle.set('');
    this.newWorkSubtitle.set('');
  }

  protected cancelAdding(): void {
    this.addingTo.set(null);
  }

  protected createWork(collectionKey: string): void {
    const title = this.newWorkTitle().trim();
    if (!title || this.creating()) return;

    this.creating.set(true);
    this.content
      .createWork({
        section: this.section(),
        kind: 'document',
        title,
        subtitle: this.newWorkSubtitle().trim(),
        collectionKey,
        // Filed at the end of its sub-section rather than at 0, which would drop a new
        // draft on top of a shelf the author has already put in order.
        sortOrder: this.works().filter((work) => work.collectionKey === collectionKey).length,
        // Created as a draft: it exists to be written into, not to be read yet.
        published: false,
      })
      .subscribe({
        next: (work) => {
          this.works.update((all) => [...all, work]);
          this.creating.set(false);
          this.addingTo.set(null);
        },
        error: (response) => {
          this.error.set(response?.error?.error ?? 'That could not be created.');
          this.creating.set(false);
        },
      });
  }

  private applyPage(page: Page): void {
    this.page.set(page);
    this.draftTitle.set(page.title ?? '');
    this.draftSubtitle.set(page.subtitle ?? '');
    // Cloned so editing a row does not mutate the loaded page.
    this.draftDialogue.set((page.dialogue ?? []).map((entry) => ({ ...entry })));
    this.draftDialogueSource.set(page.dialogueSource ?? '');
    this.draftCollections.set((page.collections ?? []).map((entry) => ({ ...entry })));
  }
}
