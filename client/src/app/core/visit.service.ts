import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export type VisitSource = 'instagram' | 'google' | 'direct' | 'other';

interface Arrival {
  source: VisitSource;
  /** The tag off a `?via=` link, or empty. */
  via: string;
}

const BEAT_MS = 20_000;
const ARRIVAL_KEY = 'maestro.arrival';
const TAB_KEY = 'maestro.tab';

/**
 * Where a reader came from, as far as a browser will say.
 *
 * Instagram opens links in its own in-app browser and often sends no referrer at all,
 * so the user agent is checked first — the app names itself there. This is a category
 * and never more: the referring URL itself is not kept or sent.
 */
export function detectSource(referrer: string, userAgent: string, ownHost: string): VisitSource {
  let host = '';
  try {
    host = referrer ? new URL(referrer).hostname : '';
  } catch {
    host = '';
  }

  if (/\bInstagram\b/i.test(userAgent) || /(^|\.)instagram\.com$/i.test(host)) return 'instagram';
  if (!host || host === ownHost) return 'direct';
  if (/(^|\.)google\.[a-z.]+$/i.test(host)) return 'google';
  return 'other';
}

/** Only what the server would keep anyway — letters, digits and dashes. */
export const cleanTag = (value: string | null | undefined): string =>
  (value ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 40).toLowerCase();

/**
 * Tells the server which page is open, and that it still is.
 *
 * This is what the author's Pulse page is built from. It carries the same anonymous
 * id reactions use — attached by the interceptor — and nothing else about the reader.
 * The author is never counted, and every failure is silent: a reader must not be able
 * to tell whether this exists.
 */
@Injectable({ providedIn: 'root' })
export class VisitService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly base = `${environment.apiBase}/visits`;
  private readonly tab = this.tabId();

  private path: string | null = null;
  private visitId: string | null = null;
  private reading: { page: number; pages: number; path: string } | null = null;
  private landed = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    const navigations = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => this.arrive(event.urlAfterRedirects));

    document.addEventListener('visibilitychange', this.onVisibility);
    this.destroyRef.onDestroy(() => {
      navigations.unsubscribe();
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.stop();
    });
  }

  /** Called by the PDF reader so the author can see how far into a book someone is. */
  progress(page: number, pages: number): void {
    // Stamped with the page it describes: the reader component is built before the
    // navigation that opens it has finished, so "which visit is this about" cannot be
    // read off the order things happen in.
    this.reading = page > 0 && pages > 0 ? { page, pages, path: location.pathname } : null;
  }

  private arrive(url: string): void {
    const tree = this.router.parseUrl(url);
    const path = url.split(/[?#]/)[0] || '/';
    const arrival = this.arrival(cleanTag(tree.queryParamMap.get('via')));

    // The tag has done its job once read. Left in the address bar it would be copied
    // along with the link, and every friend it was forwarded to would count as the
    // same placement.
    if (tree.queryParamMap.has('via')) {
      void this.router.navigate([], {
        queryParams: { via: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }

    // Same page again — a query or fragment change, or the navigation just above.
    if (path === this.path) return;

    this.path = path;
    this.visitId = null;
    this.stop();

    const privatePage = path === '/pulse' || path.startsWith(`/${environment.adminPortalPath}`);
    if (this.auth.isAdmin() || privatePage) return;

    const landing = !this.landed;
    this.landed = true;

    this.http
      .post<{ id: string } | null>(this.base, { path, tab: this.tab, landing, ...arrival })
      .subscribe({
        next: (visit) => {
          // The reader may have moved on before the answer came back.
          if (!visit?.id || this.path !== path) return;
          this.visitId = visit.id;
          this.timer = setInterval(() => this.beat(), BEAT_MS);
        },
        error: () => undefined,
      });
  }

  private beat(): void {
    if (!this.visitId || document.hidden || this.auth.isAdmin()) return;
    const { page, pages } = this.reading?.path === this.path ? this.reading : {};
    this.http
      .post(`${this.base}/${this.visitId}/beat`, { page, pages })
      .subscribe({ error: () => undefined });
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private readonly onVisibility = (): void => {
    if (!document.hidden) this.beat();
  };

  /**
   * Worked out once per tab and remembered, so a reader who arrived from Instagram
   * still reads as "from Instagram" three pages later — by then the referrer is this
   * site itself.
   */
  private arrival(via: string): Arrival {
    try {
      const stored = sessionStorage.getItem(ARRIVAL_KEY);
      if (stored) {
        this.landed = true;
        return JSON.parse(stored) as Arrival;
      }
    } catch {
      // Storage disabled: fall through and work it out again each time.
    }

    const arrival: Arrival = {
      source: detectSource(document.referrer, navigator.userAgent, location.hostname),
      via,
    };

    try {
      sessionStorage.setItem(ARRIVAL_KEY, JSON.stringify(arrival));
    } catch {
      // Nothing to do — the visit is still counted, just without a remembered source.
    }
    return arrival;
  }

  private tabId(): string {
    try {
      const existing = sessionStorage.getItem(TAB_KEY);
      if (existing) return existing;

      const minted = crypto.randomUUID();
      sessionStorage.setItem(TAB_KEY, minted);
      return minted;
    } catch {
      return crypto.randomUUID();
    }
  }
}
