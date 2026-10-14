import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { LetterService, minutesUntil } from './letter.service';

describe('minutesUntil', () => {
  const now = Date.parse('2026-10-14T10:00:00Z');
  const at = (ms: number) => new Date(now + ms).toISOString();

  it('rounds up, so a wait never reads as over before it is', () => {
    expect(minutesUntil(at(14 * 60_000 + 1), now)).toBe('15 minutes');
    expect(minutesUntil(at(30_000), now)).toBe('1 minute');
  });

  it('never says zero', () => {
    expect(minutesUntil(at(-5_000), now)).toBe('1 minute');
    expect(minutesUntil(undefined, now)).toBe('1 minute');
  });

  it('speaks in hours for a day-long block', () => {
    expect(minutesUntil(at(24 * 3_600_000), now)).toBe('24 hours');
  });
});

describe('LetterService', () => {
  let letter: LetterService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    letter = TestBed.inject(LetterService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => localStorage.clear());

  it('offers the modal when the server says it is open', async () => {
    const offer = firstValueFrom(letter.shouldOffer());
    http.expectOne((req) => req.url.endsWith('/letter/status')).flush({ state: 'open', triesLeft: 3 });
    expect(await offer).toEqual({ state: 'open', triesLeft: 3 });
  });

  it('stays shut for a blocked network, a letter that is off, or a failed request', async () => {
    for (const reply of [{ state: 'blocked' }, { state: 'off' }]) {
      const offer = firstValueFrom(letter.shouldOffer());
      http.expectOne((req) => req.url.endsWith('/letter/status')).flush(reply);
      expect(await offer).toBeNull();
    }

    const failed = firstValueFrom(letter.shouldOffer());
    http
      .expectOne((req) => req.url.endsWith('/letter/status'))
      .flush('down', { status: 503, statusText: 'Unavailable' });
    expect(await failed).toBeNull();
  });

  it('does not even ask once closed for this visit', async () => {
    letter.dismissed.set(true);
    expect(await firstValueFrom(letter.shouldOffer())).toBeNull();
    http.expectNone((req) => req.url.endsWith('/letter/status'));
  });

  it('remembers "never show again" across visits', async () => {
    letter.setNeverShow();
    const fresh = TestBed.runInInjectionContext(() => new LetterService());

    expect(fresh.neverShow).toBe(true);
    expect(await firstValueFrom(fresh.shouldOffer())).toBeNull();
    http.expectNone((req) => req.url.endsWith('/letter/status'));
  });

  it('sends the token only to the content endpoint, in its own header', () => {
    letter.token.set('a.b.c');
    letter.content().subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/letter/content'));
    expect(req.request.headers.get('X-Letter-Token')).toBe('a.b.c');
  });
});
