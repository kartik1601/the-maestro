import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ContentService } from '../../core/content.service';
import { Page, Profile } from '../../core/models';
import { SyncService } from '../../core/sync.service';
import { ImageCropperComponent } from '../../shared/image-cropper/image-cropper';
import { RichEditorComponent } from '../../shared/rich-editor/rich-editor';
import { AuthoredHtmlPipe } from '../../shared/safe-html.pipe';
import { ProseTablesDirective } from '../../shared/prose-tables.directive';
import { RefreshPillComponent } from '../../shared/refresh-pill/refresh-pill';

const SLUG = 'about-the-author';

/** Identifies the one media document the portrait always occupies. */
const AUTHOR_PORTRAIT_KEY = 'author-portrait';

/** The single standalone editable page. Same editing model as a poem or a song. */
@Component({
  selector: 'app-about',
  imports: [
    RouterLink,
    DatePipe,
    FormsModule,
    RichEditorComponent,
    ImageCropperComponent,
    AuthoredHtmlPipe,
    RefreshPillComponent,
    ProseTablesDirective,
  ],
  templateUrl: './about.html',
  styleUrl: './about.scss',
})
export class AboutComponent {
  private readonly content = inject(ContentService);
  protected readonly auth = inject(AuthService);
  protected readonly sync = inject(SyncService);

  protected readonly page = signal<Page | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly draftBody = signal('');
  protected readonly draftTitle = signal('');
  protected readonly draftSubtitle = signal('');

  /** Profile fields, held as form-friendly strings. */
  protected readonly draftPhotoUrl = signal('');
  protected readonly draftBornOn = signal('');
  protected readonly draftProfession = signal('');
  protected readonly draftPersonality = signal('');

  protected readonly saving = signal(false);
  protected readonly savedAt = signal<Date | null>(null);
  protected readonly uploadingPhoto = signal(false);

  /** Object URL the cropper is working on — non-null while the dialog is open. */
  protected readonly cropperSrc = signal<string | null>(null);
  /** Set while the stored portrait is being fetched back for a re-crop. */
  protected readonly preparingCrop = signal(false);

  protected readonly editing = computed(() => this.auth.isAdmin() && this.auth.editMode());

  protected readonly dirty = computed(() => {
    const page = this.page();
    if (!page) return false;

    return (
      this.draftBody() !== page.body ||
      this.draftTitle() !== page.title ||
      this.draftSubtitle() !== page.subtitle ||
      this.draftPhotoUrl() !== (page.profile?.photoUrl ?? '') ||
      this.draftBornOn() !== toDateInput(page.profile?.bornOn ?? null) ||
      this.draftProfession() !== (page.profile?.profession ?? '') ||
      this.draftPersonality() !== (page.profile?.personality ?? '')
    );
  });

  /** Resolved for display; the stored value stays relative. */
  protected readonly photoSrc = computed(() => {
    const url = this.editing() ? this.draftPhotoUrl() : (this.page()?.profile?.photoUrl ?? '');
    return url ? this.content.resolveMediaUrl(url) : '';
  });

  /** Rendered the way the author writes it: "January 16th, 2003". */
  protected readonly bornOnLabel = computed(() => {
    const iso = this.editing() ? this.draftBornOn() : (this.page()?.profile?.bornOn ?? '');
    if (!iso) return '';

    const date = new Date(iso);
    if (Number.isNaN(date.valueOf())) return '';

    // Stored as UTC midnight, so read it in UTC. Local getters would show the
    // previous day to any reader west of Greenwich.
    const month = date.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
    const day = date.getUTCDate();

    return `${month} ${day}${ordinalSuffix(day)}, ${date.getUTCFullYear()}`;
  });

  /**
   * Age in whole years, computed on every render rather than stored — a written-down
   * age is wrong within a year of being written.
   */
  protected readonly age = computed(() => {
    const iso = this.editing() ? this.draftBornOn() : (this.page()?.profile?.bornOn ?? '');
    if (!iso) return null;

    const born = new Date(iso);
    if (Number.isNaN(born.valueOf())) return null;

    // UTC on the birth date for the same reason as the label above.
    const today = new Date();
    let years = today.getFullYear() - born.getUTCFullYear();

    // Not yet had this year's birthday.
    const monthDelta = today.getMonth() - born.getUTCMonth();
    if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < born.getUTCDate())) years -= 1;

    return years >= 0 ? years : null;
  });

  protected readonly profession = computed(() =>
    this.editing() ? this.draftProfession() : (this.page()?.profile?.profession ?? ''),
  );

  protected readonly personality = computed(() =>
    this.editing() ? this.draftPersonality() : (this.page()?.profile?.personality ?? ''),
  );

  /** Rendered as a quiet run of details rather than a card of labelled rows. */
  protected readonly details = computed(() => {
    const rows: { key: string; value: string }[] = [];

    if (this.bornOnLabel()) rows.push({ key: 'Born', value: this.bornOnLabel() });
    if (this.age() !== null) rows.push({ key: 'Age', value: String(this.age()) });
    if (this.profession()) rows.push({ key: 'Profession', value: this.profession() });
    if (this.personality()) rows.push({ key: '16-P', value: this.personality() });

    return rows;
  });

  protected readonly hasProfile = computed(
    () => Boolean(this.photoSrc() || this.details().length > 0),
  );

  protected readonly refreshing = signal(false);

  constructor() {
    this.load();
    this.sync.watch({ page: SLUG });

    effect(() => {
      const page = this.page();
      if (page) this.resetDrafts(page);
    });

    // Leaving the page mid-crop would otherwise hold the whole photograph in memory.
    inject(DestroyRef).onDestroy(() => this.closeCropper());
  }

  protected load(): void {
    this.content.getPage(SLUG).subscribe({
      next: (page) => {
        this.page.set(page);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('This page could not be loaded.');
        this.loading.set(false);
      },
    });
  }

  /** Pulls the author's latest changes without disturbing the reader's position. */
  protected refresh(): void {
    this.refreshing.set(true);
    this.content.getPage(SLUG).subscribe({
      next: (page) => {
        this.page.set(page);
        this.refreshing.set(false);
        this.sync.acknowledge();
      },
      error: () => this.refreshing.set(false),
    });
  }

  protected save(): void {
    if (this.saving() || !this.dirty()) return;

    this.saving.set(true);

    const profile: Profile = {
      photoUrl: this.draftPhotoUrl(),
      bornOn: this.draftBornOn() || null,
      profession: this.draftProfession().trim(),
      personality: this.draftPersonality().trim(),
    };

    this.content
      .savePage(SLUG, {
        title: this.draftTitle().trim(),
        subtitle: this.draftSubtitle().trim(),
        body: this.draftBody(),
        profile,
      })
      .subscribe({
        next: (page) => {
          this.page.set(page);
          this.saving.set(false);
          this.savedAt.set(new Date());
          this.sync.acknowledge();
        },
        error: () => {
          this.error.set('Those changes were not saved.');
          this.saving.set(false);
        },
      });
  }

  protected discard(): void {
    const page = this.page();
    if (page) this.resetDrafts(page);
  }

  /**
   * A chosen file goes to the cropper first — nothing is uploaded until the author
   * has framed it. The portrait is shown as a square, and a photograph that is not
   * square gets its edges taken off one way or another; this way the author decides
   * which edges.
   */
  protected onPhotoChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.openCropper(URL.createObjectURL(file));
  }

  /** Re-frames the portrait already on the page, without asking for the file again. */
  protected adjustPhoto(): void {
    const url = this.draftPhotoUrl();
    if (!url || this.preparingCrop()) return;

    this.preparingCrop.set(true);

    // Fetched as bytes rather than pointed at directly: a cross-origin <img> would
    // taint the canvas and the crop could never be read back out.
    this.content.loadMedia(url).subscribe({
      next: (blob) => {
        this.preparingCrop.set(false);
        this.openCropper(URL.createObjectURL(blob));
      },
      error: () => {
        this.preparingCrop.set(false);
        this.error.set('That photo could not be opened for cropping.');
      },
    });
  }

  /** Uploads the framed square and points the profile at it. */
  protected onCropped(blob: Blob): void {
    const file = new File([blob], 'portrait.jpg', { type: blob.type || 'image/jpeg' });

    this.uploadingPhoto.set(true);

    // Keyed, so replacing the portrait overwrites the one stored copy rather than
    // adding another multi-megabyte document nobody will ever look at again.
    this.content.replaceKeyedImage(AUTHOR_PORTRAIT_KEY, file, 'Author portrait').subscribe({
      next: ({ url }) => {
        this.draftPhotoUrl.set(url);
        this.uploadingPhoto.set(false);
        this.closeCropper();
      },
      error: () => {
        this.error.set('That photo could not be uploaded.');
        this.uploadingPhoto.set(false);
        this.closeCropper();
      },
    });
  }

  protected closeCropper(): void {
    const url = this.cropperSrc();
    if (url) URL.revokeObjectURL(url);
    this.cropperSrc.set(null);
  }

  private openCropper(objectUrl: string): void {
    this.closeCropper();
    this.cropperSrc.set(objectUrl);
  }

  protected removePhoto(): void {
    this.draftPhotoUrl.set('');
  }

  private resetDrafts(page: Page): void {
    this.draftBody.set(page.body);
    this.draftTitle.set(page.title);
    this.draftSubtitle.set(page.subtitle);
    this.draftPhotoUrl.set(page.profile?.photoUrl ?? '');
    this.draftBornOn.set(toDateInput(page.profile?.bornOn ?? null));
    this.draftProfession.set(page.profile?.profession ?? '');
    this.draftPersonality.set(page.profile?.personality ?? '');
  }
}

/** 1st, 2nd, 3rd, 4th — with 11th/12th/13th breaking the pattern. */
function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';

  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/** `<input type="date">` speaks YYYY-MM-DD and nothing else. */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0, 10);
}
