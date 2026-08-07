import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';

interface VersionSnapshot {
  /** 'author' or 'reader' — which of the two the server counted this answer for. */
  audience: string;
  posts: string | null;
  /** Keyed by section, so an edit in Songs is not news to someone reading Poems. */
  works: Record<string, string | null>;
  pages: Record<string, string | null>;
  checkedAt: string;
}

/** What a component is watching: a page by slug, plus the collections it renders. */
export interface WatchKey {
  page?: string;
  posts?: boolean;
  /** The section whose works are on the page — a shelf's, or a single work's own. */
  works?: string;
}

const POLL_MS = 20_000;

/**
 * Tells a reader when the author has changed what they are currently looking at.
 *
 * Polls a small version endpoint rather than holding a socket open: the site has one
 * writer and many readers, so a periodic query is far cheaper than a connection per
 * visitor. Polling stops entirely while the tab is hidden, and runs once immediately
 * on return so a reader coming back to the tab is never told stale news.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  private latest: VersionSnapshot | null = null;
  private baseline: VersionSnapshot | null = null;
  private watching: WatchKey = {};
  private timer?: ReturnType<typeof setInterval>;

  /** True when the watched content has moved on since the component last rendered. */
  readonly stale = signal(false);

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibility);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.stop();
    });
  }

  /**
   * Begins watching. Call again after reloading content to re-baseline — the pill
   * disappears because the reader now holds what the server holds.
   */
  watch(key: WatchKey): void {
    this.watching = key;
    this.stale.set(false);
    this.baseline = this.latest;

    this.stop();
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Called once the component has re-fetched, so the indicator clears. */
  acknowledge(): void {
    this.baseline = this.latest;
    this.stale.set(false);
  }

  private poll(): void {
    if (document.hidden) return;

    this.http.get<VersionSnapshot>(`${environment.apiBase}/version`).subscribe({
      next: (snapshot) => {
        this.latest = snapshot;

        /**
         * The very first response establishes the baseline rather than reporting a
         * change; there is nothing to compare against yet.
         *
         * So does the first one after the session changes. The author's snapshot
         * counts drafts and a reader's does not, so the two are different views of an
         * unchanged archive — signing in, signing out or a token quietly lapsing would
         * otherwise read as "the author has edited this" and put the pill up over a
         * page nobody has touched.
         */
        if (!this.baseline || this.baseline.audience !== snapshot.audience) {
          this.baseline = snapshot;
          return;
        }

        if (this.hasChanged(this.baseline, snapshot)) this.stale.set(true);
      },
      // A failed poll is not worth telling the reader about; the next one may work.
      error: () => undefined,
    });
  }

  private hasChanged(before: VersionSnapshot, after: VersionSnapshot): boolean {
    const { page, posts, works } = this.watching;

    if (posts && before.posts !== after.posts) return true;
    if (works && before.works?.[works] !== after.works?.[works]) return true;
    if (page && before.pages?.[page] !== after.pages?.[page]) return true;

    return false;
  }

  private readonly onVisibility = (): void => {
    if (!document.hidden && this.timer) this.poll();
  };
}
