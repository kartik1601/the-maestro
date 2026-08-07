import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { filter, map, switchMap } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ContentService } from '../../core/content.service';
import { Section, Work } from '../../core/models';
import { SyncService } from '../../core/sync.service';
import { ModalService } from '../../shared/modal/modal.service';
import { RefreshPillComponent } from '../../shared/refresh-pill/refresh-pill';
import { RichEditorComponent } from '../../shared/rich-editor/rich-editor';
import { AuthoredHtmlPipe } from '../../shared/safe-html.pipe';
import { ProseTablesDirective } from '../../shared/prose-tables.directive';
import { YouTubeEmbedsDirective } from '../../shared/rich-editor/youtube-embeds.directive';
import { AudioEmbedsDirective } from '../../shared/rich-editor/audio-embeds.directive';

/**
 * A single poem or song: read as a page, edited in place by the author without
 * ever leaving it. The editor replaces the prose in the same column, at the same
 * measure, so what is written is what will be read.
 */
@Component({
  selector: 'app-document',
  imports: [
    RouterLink,
    DatePipe,
    FormsModule,
    RichEditorComponent,
    AuthoredHtmlPipe,
    YouTubeEmbedsDirective,
    AudioEmbedsDirective,
    ProseTablesDirective,
    RefreshPillComponent,
  ],
  templateUrl: './document.html',
  styleUrl: './document.scss',
})
export class DocumentComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly content = inject(ContentService);
  private readonly modal = inject(ModalService);
  protected readonly auth = inject(AuthService);
  protected readonly sync = inject(SyncService);

  protected readonly work = signal<Work | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly refreshing = signal(false);

  protected readonly draftBody = signal('');
  protected readonly draftTitle = signal('');
  protected readonly draftSubtitle = signal('');

  protected readonly saving = signal(false);
  protected readonly savedAt = signal<Date | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly deleting = signal(false);

  protected readonly editing = computed(() => this.auth.isAdmin() && this.auth.editMode());
  protected readonly backLink = computed(() => `/${this.work()?.section ?? ''}`);

  protected readonly dirty = computed(() => {
    const work = this.work();
    if (!work) return false;

    return (
      this.draftBody() !== (work.body ?? '') ||
      this.draftTitle() !== work.title ||
      this.draftSubtitle() !== work.subtitle
    );
  });

  constructor() {
    this.route.paramMap
      .pipe(
        map((params) => params.get('slug') ?? ''),
        // Renaming a work rewrites the address to match its new title. That is a real
        // navigation, but the work is already loaded and already current — refetching
        // it would only throw away the "Saved" line the author just earned.
        filter((slug) => slug !== this.work()?.slug),
        switchMap((slug) => {
          this.loading.set(true);
          const section = this.route.snapshot.data['section'] as Section;
          this.sync.watch({ works: section });
          return this.content.getWork(section, slug);
        }),
      )
      .subscribe({
        next: (work) => {
          this.work.set(work);
          this.loading.set(false);
        },
        error: () => {
          this.notFound.set(true);
          this.loading.set(false);
        },
      });

    // Reset the drafts whenever a different work loads, so edits cannot leak from
    // one poem onto the next.
    effect(() => {
      const work = this.work();
      if (!work) return;

      this.draftBody.set(work.body ?? '');
      this.draftTitle.set(work.title);
      this.draftSubtitle.set(work.subtitle);
      this.savedAt.set(null);
    });
  }

  /**
   * Re-reads the work the reader is on. Never automatic: pulling a poem out from
   * under someone mid-line is worse than their being a minute out of date.
   */
  protected refresh(): void {
    const work = this.work();
    if (!work || this.refreshing()) return;

    this.refreshing.set(true);
    this.content.getWork(work.section, work.slug).subscribe({
      next: (fresh) => {
        this.work.set(fresh);
        this.refreshing.set(false);
        this.sync.acknowledge();
      },
      error: () => this.refreshing.set(false),
    });
  }

  protected save(): void {
    const work = this.work();
    if (!work || this.saving() || !this.dirty()) return;

    this.saving.set(true);
    this.saveError.set(null);

    this.content
      .saveWork(work.id, {
        title: this.draftTitle().trim(),
        subtitle: this.draftSubtitle().trim(),
        body: this.draftBody(),
      })
      .subscribe({
        next: (updated) => {
          this.work.set(updated);
          this.saving.set(false);
          this.savedAt.set(new Date());
          // The author's own save moved the section on; it is not news to them.
          this.sync.acknowledge();

          // The slug is made from the title, so a rename moves the work. Replaces the
          // history entry rather than adding one: the old address is gone, and Back
          // should return to the shelf, not to a page that now 404s.
          if (updated.slug !== work.slug) {
            this.router.navigate(['/', updated.section, updated.slug], { replaceUrl: true });
          }
        },
        error: () => {
          this.saveError.set('Those changes were not saved.');
          this.saving.set(false);
        },
      });
  }

  protected discard(): void {
    const work = this.work();
    if (!work) return;

    this.draftBody.set(work.body ?? '');
    this.draftTitle.set(work.title);
    this.draftSubtitle.set(work.subtitle);
  }

  /**
   * There is no undo and no trash: the API deletes the row outright. So the modal
   * names the work being deleted rather than asking about "this item", and unsaved
   * work in the editor is called out — losing a draft you were part-way through is a
   * different kind of loss from deleting something you had finished with.
   */
  protected async remove(): Promise<void> {
    const work = this.work();
    if (!work || this.deleting()) return;

    const confirmed = await this.modal.confirm({
      title: `Delete "${work.title}"?`,
      message: this.dirty()
        ? 'This cannot be undone, and the unsaved changes in the editor go with it.'
        : 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;

    this.deleting.set(true);
    this.saveError.set(null);

    this.content.deleteWork(work.id).subscribe({
      // Back to the shelf, which refetches on arrival — so the card is already gone
      // rather than lingering until the next reload.
      next: () => this.router.navigate([this.backLink()]),
      error: () => {
        this.saveError.set('That could not be deleted.');
        this.deleting.set(false);
      },
    });
  }

  protected togglePublished(): void {
    const work = this.work();
    if (!work) return;

    this.content.saveWork(work.id, { published: !work.published }).subscribe((updated) => {
      this.work.set({ ...work, published: updated.published });
    });
  }
}
