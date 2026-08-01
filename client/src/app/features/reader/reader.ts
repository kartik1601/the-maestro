import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { NgxExtendedPdfViewerModule, PageViewModeType } from 'ngx-extended-pdf-viewer';
import { AuthService } from '../../core/auth.service';
import { ContentService } from '../../core/content.service';
import { Section, Work } from '../../core/models';

type Spread = 'single' | 'double';

/**
 * The e-reading surface for Novels, Plays and Novelettes.
 *
 * ngx-extended-pdf-viewer wraps pdf.js; the site supplies the chrome so the reader
 * feels like part of the archive rather than an embedded PDF plugin. Page turning,
 * spread mode and zoom are lifted out into the header bar, and the viewer's own
 * toolbar is hidden.
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
  protected readonly auth = inject(AuthService);

  protected readonly work = signal<Work | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);

  protected readonly page = signal(1);
  protected readonly totalPages = signal(0);
  protected readonly spread = signal<Spread>('single');
  protected readonly zoom = signal<number | 'page-fit' | 'page-width'>('page-fit');
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  protected readonly src = computed(() => {
    const work = this.work();
    return work?.pdf.hasFile ? this.content.pdfUrl(work.section, work.slug) : null;
  });

  protected readonly pageViewMode = computed<PageViewModeType>(() =>
    this.spread() === 'double' ? 'book' : 'single',
  );

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
    const step = this.spread() === 'double' ? 2 : 1;
    const total = this.totalPages() || 1;
    this.page.set(Math.min(Math.max(1, this.page() + direction * step), total));
  }

  protected toggleSpread(): void {
    this.spread.update((mode) => (mode === 'single' ? 'double' : 'single'));
  }

  protected cycleZoom(): void {
    const order: (number | 'page-fit' | 'page-width')[] = ['page-fit', 'page-width', 1.25, 1.5];
    const index = order.indexOf(this.zoom());
    this.zoom.set(order[(index + 1) % order.length]);
  }

  protected zoomLabel(): string {
    const zoom = this.zoom();
    if (zoom === 'page-fit') return 'Fit page';
    if (zoom === 'page-width') return 'Fit width';
    return `${Math.round(zoom * 100)}%`;
  }

  /** pdf.js is the authority on page count once the file has actually parsed. */
  protected onPagesLoaded(count: number): void {
    this.totalPages.set(count);
  }

  /** pdf.js reports `undefined` while a document is still being swapped in. */
  protected onPageChange(page: number | undefined): void {
    if (typeof page === 'number' && page > 0) this.page.set(page);
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
        this.work.set({ ...work, pdf: updated.pdf });
        this.totalPages.set(updated.pdf.pageCount ?? 0);
        this.uploading.set(false);
        input.value = '';
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
