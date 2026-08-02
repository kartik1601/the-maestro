import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ContentService } from '../../core/content.service';
import { Section, Work } from '../../core/models';
import { RichEditorComponent } from '../../shared/rich-editor/rich-editor';
import { AuthoredHtmlPipe } from '../../shared/safe-html.pipe';
import { YouTubeEmbedsDirective } from '../../shared/rich-editor/youtube-embeds.directive';

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
  ],
  templateUrl: './document.html',
  styleUrl: './document.scss',
})
export class DocumentComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly content = inject(ContentService);
  protected readonly auth = inject(AuthService);

  protected readonly work = signal<Work | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);

  protected readonly draftBody = signal('');
  protected readonly draftTitle = signal('');
  protected readonly draftSubtitle = signal('');

  protected readonly saving = signal(false);
  protected readonly savedAt = signal<Date | null>(null);
  protected readonly saveError = signal<string | null>(null);

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
        switchMap((params) => {
          this.loading.set(true);
          const section = this.route.snapshot.data['section'] as Section;
          return this.content.getWork(section, params.get('slug') ?? '');
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

  protected togglePublished(): void {
    const work = this.work();
    if (!work) return;

    this.content.saveWork(work.id, { published: !work.published }).subscribe((updated) => {
      this.work.set({ ...work, published: updated.published });
    });
  }
}
