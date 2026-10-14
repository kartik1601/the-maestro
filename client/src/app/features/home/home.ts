import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ContentService } from '../../core/content.service';
import { SyncService } from '../../core/sync.service';
import { EMOTE_META, EMOTE_ORDER, Emote, Page, Post, SECTION_META } from '../../core/models';
import { RichEditorComponent } from '../../shared/rich-editor/rich-editor';
import { AuthoredHtmlPipe } from '../../shared/safe-html.pipe';
import { ProseTablesDirective } from '../../shared/prose-tables.directive';
import { RefreshPillComponent } from '../../shared/refresh-pill/refresh-pill';
import { ModalService } from '../../shared/modal/modal.service';

const SLUG = 'blogs';

@Component({
  selector: 'app-home',
  imports: [
    RouterLink,
    DatePipe,
    FormsModule,
    RichEditorComponent,
    AuthoredHtmlPipe,
    RefreshPillComponent,
    ProseTablesDirective,
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent {
  private readonly content = inject(ContentService);
  private readonly modal = inject(ModalService);
  protected readonly auth = inject(AuthService);
  protected readonly sync = inject(SyncService);

  protected readonly posts = signal<Post[]>([]);
  protected readonly page = signal<Page | null>(null);
  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly draft = signal('');
  protected readonly posting = signal(false);

  /** Id of the post currently open for editing, and its working copy. */
  protected readonly editingId = signal<string | null>(null);
  protected readonly editDraft = signal('');
  protected readonly savingEdit = signal(false);

  /** Page copy, edited in place by the author. */
  protected readonly draftVerse = signal('');
  protected readonly draftVerseSource = signal('');
  protected readonly draftSubtitle = signal('');
  protected readonly savingPage = signal(false);

  protected readonly emotes = EMOTE_ORDER;
  protected readonly emoteMeta = EMOTE_META;

  /** Section cards: headings only, no supporting text. */
  protected readonly sections = SECTION_META.filter(
    (section) => section.key !== 'about' && section.key !== 'blogs',
  );

  protected readonly editing = computed(() => this.auth.isAdmin() && this.auth.editMode());
  protected readonly hasDraft = computed(() => stripHtml(this.draft()).length > 0);

  protected readonly verseLines = computed(() => this.page()?.verse ?? []);

  protected readonly pageDirty = computed(() => {
    const page = this.page();
    if (!page) return false;

    return (
      this.draftVerse() !== (page.verse ?? []).join('\n') ||
      this.draftVerseSource() !== page.verseSource ||
      this.draftSubtitle() !== page.subtitle
    );
  });

  constructor() {
    this.load();
    this.sync.watch({ page: SLUG, posts: true });
  }

  protected load(): void {
    this.loading.set(true);

    forkJoin({ feed: this.content.feed(), page: this.content.getPage(SLUG) }).subscribe({
      next: ({ feed, page }) => {
        this.posts.set(feed.posts);
        this.applyPage(page);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('The page could not be loaded. Is the API running?');
        this.loading.set(false);
      },
    });
  }

  /** Pulls the author's latest changes without losing the reader's scroll position. */
  protected refresh(): void {
    this.refreshing.set(true);

    forkJoin({ feed: this.content.feed(), page: this.content.getPage(SLUG) }).subscribe({
      next: ({ feed, page }) => {
        this.posts.set(feed.posts);
        this.applyPage(page);
        this.refreshing.set(false);
        this.sync.acknowledge();
      },
      error: () => this.refreshing.set(false),
    });
  }

  // ── Reactions ──────────────────────────────────────────────────────────────

  /**
   * Reactions apply immediately and roll back if the server disagrees — a tap on a
   * heart should never feel like it is waiting for a network.
   */
  protected react(post: Post, emote: Emote): void {
    const wasReacted = post.myReactions.includes(emote);
    this.applyReaction(post.id, emote, !wasReacted);

    this.content.react(post.id, emote).subscribe({
      next: (result) =>
        this.replacePost(post.id, (item) => ({ ...item, reactionCounts: result.counts })),
      error: () => this.applyReaction(post.id, emote, wasReacted),
    });
  }

  protected countOf(post: Post, emote: Emote): number {
    return post.reactionCounts?.[emote] ?? 0;
  }

  protected hasReacted(post: Post, emote: Emote): boolean {
    return post.myReactions.includes(emote);
  }

  // ── Posts ──────────────────────────────────────────────────────────────────

  protected publish(): void {
    if (!this.hasDraft() || this.posting()) return;

    this.posting.set(true);
    this.content.createPost(this.draft()).subscribe({
      next: (post) => {
        this.posts.update((posts) => [post, ...posts]);
        this.draft.set('');
        this.posting.set(false);
      },
      error: () => {
        this.error.set('That post could not be published.');
        this.posting.set(false);
      },
    });
  }

  protected async remove(post: Post): Promise<void> {
    const confirmed = await this.modal.confirm({
      title: 'Delete this post?',
      message: 'Its reactions go with it. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;

    this.content.deletePost(post.id).subscribe(() => {
      this.posts.update((posts) => posts.filter((item) => item.id !== post.id));
    });
  }

  protected startEditing(post: Post): void {
    this.editingId.set(post.id);
    this.editDraft.set(post.body);
  }

  protected cancelEditing(): void {
    this.editingId.set(null);
    this.editDraft.set('');
  }

  protected saveEdit(post: Post): void {
    if (this.savingEdit()) return;

    this.savingEdit.set(true);
    this.content.updatePost(post.id, { body: this.editDraft() }).subscribe({
      next: (updated) => {
        this.replacePost(post.id, (item) => ({ ...item, body: updated.body }));
        this.savingEdit.set(false);
        this.cancelEditing();
      },
      error: () => {
        this.error.set('That edit could not be saved.');
        this.savingEdit.set(false);
      },
    });
  }

  /**
   * Pinning is a toggle rather than a single slot — the server sorts pinned posts
   * first, so several may be pinned and they stay in date order among themselves.
   */
  protected togglePinned(post: Post): void {
    const next = !post.pinned;
    this.replacePost(post.id, (item) => ({ ...item, pinned: next }));
    this.resort();

    this.content.updatePost(post.id, { pinned: next }).subscribe({
      error: () => {
        this.replacePost(post.id, (item) => ({ ...item, pinned: !next }));
        this.resort();
        this.error.set('That post could not be pinned.');
      },
    });
  }

  // ── Page copy ──────────────────────────────────────────────────────────────

  protected savePage(): void {
    if (this.savingPage() || !this.pageDirty()) return;

    this.savingPage.set(true);
    this.content
      .savePage(SLUG, {
        verse: this.draftVerse().split('\n'),
        verseSource: this.draftVerseSource().trim(),
        subtitle: this.draftSubtitle().trim(),
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

  // ── Internals ──────────────────────────────────────────────────────────────

  private applyPage(page: Page): void {
    this.page.set(page);
    this.draftVerse.set((page.verse ?? []).join('\n'));
    this.draftVerseSource.set(page.verseSource ?? '');
    this.draftSubtitle.set(page.subtitle ?? '');
  }

  private applyReaction(postId: string, emote: Emote, reacted: boolean): void {
    this.replacePost(postId, (post) => {
      const counts = { ...post.reactionCounts };
      counts[emote] = Math.max(0, (counts[emote] ?? 0) + (reacted ? 1 : -1));

      return {
        ...post,
        reactionCounts: counts,
        myReactions: reacted
          ? [...post.myReactions, emote]
          : post.myReactions.filter((item) => item !== emote),
      };
    });
  }

  private replacePost(id: string, change: (post: Post) => Post): void {
    this.posts.update((posts) => posts.map((item) => (item.id === id ? change(item) : item)));
  }

  /** Mirrors the server's ordering so a pin moves the card immediately. */
  private resort(): void {
    this.posts.update((posts) =>
      [...posts].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }),
    );
  }
}

/** Guards against publishing a post whose only content is empty markup. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}
