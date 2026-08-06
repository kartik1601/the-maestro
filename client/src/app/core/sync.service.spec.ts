import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SyncService } from './sync.service';
import { environment } from '../../environments/environment';

const VERSION = `${environment.apiBase}/version`;
const POLL_MS = 20_000;

interface Snapshot {
  posts: string | null;
  works: string | null;
  pages: Record<string, string | null>;
  checkedAt: string;
}

const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  posts: '2026-01-01T00:00:00.000Z',
  works: '2026-01-01T00:00:00.000Z',
  pages: { poems: '2026-01-01T00:00:00.000Z', novels: '2026-01-01T00:00:00.000Z' },
  checkedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('SyncService', () => {
  let sync: SyncService;
  let http: HttpTestingController;
  let hidden: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    sync = TestBed.inject(SyncService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    sync.stop();
    http.verify();
    vi.useRealTimers();
  });

  /** Answers the poll that `watch` fires immediately, establishing the baseline. */
  const settleBaseline = (initial = snapshot()) => {
    http.expectOne(VERSION).flush(initial);
  };

  it('polls once as soon as it starts watching', () => {
    sync.watch({ works: true });
    settleBaseline();
    expect(sync.stale()).toBe(false);
  });

  it('treats the first response as the baseline rather than a change', () => {
    sync.watch({ posts: true });
    settleBaseline(snapshot({ posts: 'anything' }));
    expect(sync.stale()).toBe(false);
  });

  it('reports staleness when a watched collection moves on', () => {
    sync.watch({ works: true });
    settleBaseline();

    vi.advanceTimersByTime(POLL_MS);
    http.expectOne(VERSION).flush(snapshot({ works: '2026-02-02T00:00:00.000Z' }));

    expect(sync.stale()).toBe(true);
  });

  it('stays quiet when something the component is not watching changes', () => {
    sync.watch({ works: true });
    settleBaseline();

    vi.advanceTimersByTime(POLL_MS);
    http.expectOne(VERSION).flush(snapshot({ posts: '2026-02-02T00:00:00.000Z' }));

    expect(sync.stale()).toBe(false);
  });

  it('watches one page by slug, so an edit elsewhere does not interrupt', () => {
    sync.watch({ page: 'poems' });
    settleBaseline(snapshot({ pages: { poems: 'same', novels: 'first' } }));

    vi.advanceTimersByTime(POLL_MS);
    http.expectOne(VERSION).flush(snapshot({ pages: { poems: 'same', novels: 'changed' } }));
    expect(sync.stale()).toBe(false);

    vi.advanceTimersByTime(POLL_MS);
    http.expectOne(VERSION).flush(snapshot({ pages: { poems: 'moved on', novels: 'changed' } }));
    expect(sync.stale()).toBe(true);
  });

  it('clears the indicator once the component has re-fetched', () => {
    sync.watch({ works: true });
    settleBaseline();

    vi.advanceTimersByTime(POLL_MS);
    http.expectOne(VERSION).flush(snapshot({ works: 'moved on' }));
    expect(sync.stale()).toBe(true);

    sync.acknowledge();
    expect(sync.stale()).toBe(false);

    // And the new value is the baseline now — the same response is no longer news.
    vi.advanceTimersByTime(POLL_MS);
    http.expectOne(VERSION).flush(snapshot({ works: 'moved on' }));
    expect(sync.stale()).toBe(false);
  });

  it('re-baselines when the reader navigates to another section', () => {
    sync.watch({ works: true });
    settleBaseline();
    vi.advanceTimersByTime(POLL_MS);
    http.expectOne(VERSION).flush(snapshot({ works: 'moved on' }));
    expect(sync.stale()).toBe(true);

    sync.watch({ page: 'songs' });
    http.expectOne(VERSION).flush(snapshot({ works: 'moved on' }));
    expect(sync.stale()).toBe(false);
  });

  it('does not poll while the tab is hidden', () => {
    sync.watch({ works: true });
    settleBaseline();

    hidden = true;
    vi.advanceTimersByTime(POLL_MS * 3);
    http.expectNone(VERSION);
  });

  it('polls immediately when the reader comes back to the tab', () => {
    sync.watch({ works: true });
    settleBaseline();

    hidden = true;
    vi.advanceTimersByTime(POLL_MS);
    http.expectNone(VERSION);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    http.expectOne(VERSION).flush(snapshot({ works: 'moved on' }));
    expect(sync.stale()).toBe(true);
  });

  it('stops polling when told to', () => {
    sync.watch({ works: true });
    settleBaseline();

    sync.stop();
    vi.advanceTimersByTime(POLL_MS * 3);
    http.expectNone(VERSION);
  });

  it('says nothing to the reader about a failed poll', () => {
    sync.watch({ works: true });
    settleBaseline();

    vi.advanceTimersByTime(POLL_MS);
    http.expectOne(VERSION).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(sync.stale()).toBe(false);

    // And the next poll still runs.
    vi.advanceTimersByTime(POLL_MS);
    http.expectOne(VERSION).flush(snapshot({ works: 'moved on' }));
    expect(sync.stale()).toBe(true);
  });
});
