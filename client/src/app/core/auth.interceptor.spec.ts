import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { ReactorService } from './reactor.service';
import { environment } from '../../environments/environment';

const AUTH_BASE = `${environment.apiBase}/${environment.adminPortalPath}/auth`;
const WORKS = `${environment.apiBase}/works/poems`;

const expiredBody = { code: 'TOKEN_EXPIRED' };

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => backend.verify());

  /** Signs in without going through the interceptor's own retry path. */
  const signIn = (token = 'a-token') => {
    auth.login({ username: 'u', password: 'p', authKey: 'k' }).subscribe();
    backend
      .expectOne(`${AUTH_BASE}/login`)
      .flush({ accessToken: token, admin: { displayName: 'K' } });
  };

  it('sends the visitor reactor id on every request', () => {
    http.get(WORKS).subscribe();

    const request = backend.expectOne(WORKS);
    expect(request.request.headers.get('X-Reactor-Id')).toBe(TestBed.inject(ReactorService).id);
    request.flush({});
  });

  it('sends no bearer token while nobody is signed in', () => {
    http.get(WORKS).subscribe();

    const request = backend.expectOne(WORKS);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });

  it("attaches the author's token once signed in", () => {
    signIn('the-access-token');
    http.get(WORKS).subscribe();

    const request = backend.expectOne(WORKS);
    expect(request.request.headers.get('Authorization')).toBe('Bearer the-access-token');
    request.flush({});
  });

  it('never attaches a bearer token to the auth endpoints themselves', () => {
    signIn();
    http.post(`${AUTH_BASE}/refresh`, {}).subscribe();

    const request = backend.expectOne(`${AUTH_BASE}/refresh`);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({ accessToken: 'x', admin: { displayName: 'K' } });
  });

  it('refreshes and retries once when the access token has expired', () => {
    signIn('stale-token');

    const results: unknown[] = [];
    http.get(WORKS).subscribe((value) => results.push(value));

    backend.expectOne(WORKS).flush(expiredBody, { status: 401, statusText: 'Unauthorized' });

    backend
      .expectOne(`${AUTH_BASE}/refresh`)
      .flush({ accessToken: 'fresh-token', admin: { displayName: 'K' } });

    const retry = backend.expectOne(WORKS);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer fresh-token');
    retry.flush({ ok: true });

    expect(results).toEqual([{ ok: true }]);
  });

  it('gives up and surfaces the error when the refresh fails', () => {
    signIn('stale-token');

    const errors: unknown[] = [];
    http.get(WORKS).subscribe({ error: (error) => errors.push(error) });

    backend.expectOne(WORKS).flush(expiredBody, { status: 401, statusText: 'Unauthorized' });
    backend
      .expectOne(`${AUTH_BASE}/refresh`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(errors).toHaveLength(1);
    expect(auth.isAdmin()).toBe(false);
  });

  it('does not retry a 401 that is not an expiry', () => {
    signIn();

    const errors: unknown[] = [];
    http.get(WORKS).subscribe({ error: (error) => errors.push(error) });

    backend.expectOne(WORKS).flush({ error: 'Nope' }, { status: 401, statusText: 'Unauthorized' });

    backend.expectNone(`${AUTH_BASE}/refresh`);
    expect(errors).toHaveLength(1);
  });

  it('does not retry other failures', () => {
    signIn();

    const errors: unknown[] = [];
    http.get(WORKS).subscribe({ error: (error) => errors.push(error) });

    backend.expectOne(WORKS).flush({}, { status: 500, statusText: 'Server Error' });

    backend.expectNone(`${AUTH_BASE}/refresh`);
    expect(errors).toHaveLength(1);
  });

  it('does not try to refresh a failing refresh call', () => {
    signIn();

    const errors: unknown[] = [];
    http.post(`${AUTH_BASE}/refresh`, {}).subscribe({ error: (error) => errors.push(error) });

    backend
      .expectOne(`${AUTH_BASE}/refresh`)
      .flush(expiredBody, { status: 401, statusText: 'Unauthorized' });

    backend.expectNone(`${AUTH_BASE}/refresh`);
    expect(errors).toHaveLength(1);
  });
});
