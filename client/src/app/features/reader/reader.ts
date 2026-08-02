import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { NgxExtendedPdfViewerModule, PageViewModeType } from 'ngx-extended-pdf-viewer';
import { AuthService } from '../../core/auth.service';
import { ContentService } from '../../core/content.service';
import { Section, Work } from '../../core/models';
import { ModalService } from '../../shared/modal/modal.service';


/**
 * The e-reading surface for Novels, Plays and Novelettes.
 *
 * ngx-extended-pdf-viewer wraps pdf.js; the site supplies the chrome so the reader
 * feels like part of the archive rather than an embedded PDF plugin. Page turning and
 * page fitting are lifted out into the header bar, and the viewer's own toolbar is
 * hidden.
 */
@Component({
  selector: 'app-reader',
  imports: [RouterLink, NgxExtendedPdfViewerModule],
  templateUrl: './reader.html',
  styleUrl: './reader.scss',
})
export class ReaderComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly content = inject(ContentService);
  private readonly modal = inject(ModalService);
  protected readonly auth = inject(AuthService);

  protected readonly work = signal<Work | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);

  protected readonly page = signal(1);
  protected readonly totalPages = signal(0);

  /**
   * Two fitting modes and nothing else. Percentage steps were removed: they fought
   * the fixed-height sheet, and a reader wants the page to fit, not a zoom level.
   */
  protected readonly zoom = signal<'page-fit' | 'page-width'>('page-fit');
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  /**
   * The document bytes, fetched through the authenticated client and handed to the
   * viewer directly. Null until they arrive, or when there is no file.
   */
  protected readonly src = signal<Blob | string | null>(null);
  protected readonly loadingPdf = signal(false);
  protected readonly pdfError = signal<string | null>(null);

  /** Single page always — the two-page spread was removed. */
  protected readonly pageViewMode: PageViewModeType = 'single';

  protected readonly progress = computed(() => {
    const total = this.totalPages();
    return total > 0 ? Math.round((this.page() / total) * 100) : 0;
  });

  protected readonly backLink = computed(() => `/${this.work()?.section ?? ''}`);

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
          this.totalPages.set(work.pdf.pageCount ?? 0);
          this.page.set(1);
          this.loading.set(false);
          this.loadPdf(work);
        },
        error: () => {
          this.notFound.set(true);
          this.loading.set(false);
        },
      });
  }

  /** Arrow keys turn pages, the way they would in any reader. */
  @HostListener('window:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    // Never hijack keys while the author is typing into the title or a form.
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (target?.isContentEditable) return;

    if (event.key === 'ArrowRight' || event.key === 'PageDown') {
      this.turn(1);
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      this.turn(-1);
      event.preventDefault();
    }
  }

  protected turn(direction: 1 | -1): void {
    const total = this.totalPages() || 1;
    this.page.set(Math.min(Math.max(1, this.page() + direction), total));
  }

  protected toggleZoom(): void {
    this.zoom.update((mode) => (mode === 'page-fit' ? 'page-width' : 'page-fit'));
  }

  protected zoomLabel(): string {
    return this.zoom() === 'page-fit' ? 'Fit page' : 'Fit width';
  }

  /** pdf.js is the authority on page count once the file has actually parsed. */
  protected onPagesLoaded(count: number): void {
    this.totalPages.set(count);
  }

  /** pdf.js reports `undefined` while a document is still being swapped in. */
  protected onPageChange(page: number | undefined): void {
    if (typeof page === 'number' && page > 0) this.page.set(page);
  }

  private loadPdf(work: Work): void {
    this.src.set(null);
    this.pdfError.set(null);
    if (!work.pdf.hasFile) return;

    this.loadingPdf.set(true);

    this.content.pdfLink(work.section, work.slug).subscribe({
      next: ({ url }) => {
        if (url) {
          // In object storage: pdf.js fetches it directly and can request byte
          // ranges, so the first page appears without the whole file arriving.
          this.src.set(url);
          this.loadingPdf.set(false);
          return;
        }

        // In MongoDB: pull the bytes through the API, which carries the session.
        this.content.loadPdf(work.section, work.slug).subscribe({
          next: (blob) => {
            this.src.set(blob);
            this.loadingPdf.set(false);
          },
          error: () => {
            this.pdfError.set('That file could not be opened.');
            this.loadingPdf.set(false);
          },
        });
      },
      error: () => {
        this.pdfError.set('That file could not be opened.');
        this.loadingPdf.set(false);
      },
    });
  }

  /** Detaches the file from the work; the shelf entry stays so it can be replaced. */
  protected async removePdf(): Promise<void> {
    const work = this.work();
    if (!work) return;

    const confirmed = await this.modal.confirm({
      title: 'Remove this PDF?',
      message: `"${work.title}" stays on the shelf and can be uploaded again. The file itself is deleted.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!confirmed) return;

    this.content.removePdf(work.id).subscribe({
      next: (updated) => {
        this.work.set({ ...work, pdf: updated.pdf });
        this.src.set(null);
        this.totalPages.set(0);
        this.page.set(1);
      },
      error: () => this.uploadError.set('That file could not be removed.'),
    });
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const work = this.work();
    if (!file || !work) return;

    this.uploading.set(true);
    this.uploadError.set(null);

    this.content.uploadPdf(work.id, file).subscribe({
      next: (updated) => {
        const next = { ...work, pdf: updated.pdf };
        this.work.set(next);
        this.totalPages.set(updated.pdf.pageCount ?? 0);
        this.uploading.set(false);
        input.value = '';
        this.loadPdf(next);
      },
      error: (error) => {
        this.uploadError.set(error?.error?.error ?? 'That upload did not go through.');
        this.uploading.set(false);
        input.value = '';
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

  protected goBack(): void {
    this.router.navigate([this.backLink()]);
  }
}
