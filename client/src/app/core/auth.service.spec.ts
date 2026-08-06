import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService, Credentials } from './auth.service';
import { environment } from '../../environments/environment';

const BASE = `${environment.apiBase}/${environment.adminPortalPath}/auth`;

/** A token whose payload carries the given `exp`; only the claim is ever read. */
function tokenExpiringAt(epochSeconds: number | string | null): string {
  const payload = epochSeconds === null ? {} : { exp: epochSeconds };
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '');
  return `header.${encode(payload)}.signature`;
}

const credentials: Credentials = {
  username: 'author',
  password: 'a-passphrase',
  authKey: 'a-key',
};

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts as a reader, with no session and no edit mode', () => {
    expect(auth.isAdmin()).toBe(false);
    expect(auth.token()).toBeNull();
    expect(auth.adminName()).toBeNull();
    expect(auth.editMode()).toBe(false);
  });

  describe('login', () => {
    it('sends the three factors and accepts the session', () => {
      auth.login(credentials).subscribe();

      const request = http.expectOne(`${BASE}/login`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual(credentials);
      // The refresh cookie is httpOnly, so the call has to carry credentials.
      expect(request.request.withCredentials).toBe(true);

      request.flush({ accessToken: tokenExpiringAt(2000), admin: { displayName: 'K' } });

      expect(auth.isAdmin()).toBe(true);
      expect(auth.adminName()).toBe('K');
    });

    it('reads the expiry out of the token so the guard knows when to ask', () => {
      auth.login(credentials).subscribe();
      http
        .expectOne(`${BASE}/login`)
        .flush({ accessToken: tokenExpiringAt(1_700_000_000), admin: { displayName: 'K' } });

      expect(auth.accessTokenExpiry()).toBe(1_700_000_000_000);
    });

    it('falls back to a name when the server sends none', () => {
      auth.login(credentials).subscribe();
      http.expectOne(`${BASE}/login`).flush({ accessToken: tokenExpiringAt(2000) });

      expect(auth.adminName()).toBe('The Author');
    });

    it('leaves the expiry null when the token carries no readable claim', () => {
      auth.login(credentials).subscribe();
      http
        .expectOne(`${BASE}/login`)
        .flush({ accessToken: 'not-a-jwt', admin: { displayName: 'K' } });

      expect(auth.isAdmin()).toBe(true);
      expect(auth.accessTokenExpiry()).toBeNull();
    });

    it('leaves the expiry null when exp is not a number', () => {
      auth.login(credentials).subscribe();
      http
        .expectOne(`${BASE}/login`)
        .flush({ accessToken: tokenExpiringAt('soon'), admin: { displayName: 'K' } });

      expect(auth.accessTokenExpiry()).toBeNull();
    });

    it('stays a reader when the credentials are refused', () => {
      const outcomes: unknown[] = [];
      auth.login(credentials).subscribe({ error: (error) => outcomes.push(error) });

      http
        .expectOne(`${BASE}/login`)
        .flush({ error: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });

      expect(outcomes).toHaveLength(1);
      expect(auth.isAdmin()).toBe(false);
    });
  });

  describe('refresh', () => {
    it('resolves true and accepts the new token', () => {
      const results: boolean[] = [];
      auth.refresh().subscribe((value) => results.push(value));

      http
        .expectOne(`${BASE}/refresh`)
        .flush({ accessToken: tokenExpiringAt(3000), admin: { displayName: 'K' } });

      expect(results).toEqual([true]);
      expect(auth.isAdmin()).toBe(true);
    });

    it('resolves false and clears the session when the cookie is gone', () => {
      auth.login(credentials).subscribe();
      http
        .expectOne(`${BASE}/login`)
        .flush({ accessToken: tokenExpiringAt(2000), admin: { displayName: 'K' } });
      auth.editMode.set(true);

      const results: boolean[] = [];
      auth.refresh().subscribe((value) => results.push(value));
      http.expectOne(`${BASE}/refresh`).flush({}, { status: 401, statusText: 'Unauthorized' });

      expect(results).toEqual([false]);
      expect(auth.isAdmin()).toBe(false);
      expect(auth.adminName()).toBeNull();
      expect(auth.accessTokenExpiry()).toBeNull();
      // Signing out has to leave the site read-only, not editable-but-anonymous.
      expect(auth.editMode()).toBe(false);
    });

    it('makes one request for a burst of concurrent callers', () => {
      const results: boolean[] = [];
      auth.refresh().subscribe((value) => results.push(value));
      auth.refresh().subscribe((value) => results.push(value));
      auth.refresh().subscribe((value) => results.push(value));

      http
        .expectOne(`${BASE}/refresh`)
        .flush({ accessToken: tokenExpiringAt(3000), admin: { displayName: 'K' } });

      expect(results).toEqual([true, true, true]);
    });

    it('starts fresh once the in-flight refresh has finished', () => {
      auth.refresh().subscribe();
      http
        .expectOne(`${BASE}/refresh`)
        .flush({ accessToken: tokenExpiringAt(3000), admin: { displayName: 'K' } });

      auth.refresh().subscribe();
      http
        .expectOne(`${BASE}/refresh`)
        .flush({ accessToken: tokenExpiringAt(4000), admin: { displayName: 'K' } });

      expect(auth.accessTokenExpiry()).toBe(4_000_000);
    });

    it('is what restoreSession asks for at startup', () => {
      auth.restoreSession().subscribe();
      http.expectOne(`${BASE}/refresh`).flush({}, { status: 401, statusText: 'Unauthorized' });
      expect(auth.isAdmin()).toBe(false);
    });
  });

  describe('logout', () => {
    beforeEach(() => {
      auth.login(credentials).subscribe();
      http
        .expectOne(`${BASE}/login`)
        .flush({ accessToken: tokenExpiringAt(2000), admin: { displayName: 'K' } });
      auth.editMode.set(true);
    });

    it('ends the session', () => {
      auth.logout().subscribe();
      http.expectOne(`${BASE}/logout`).flush(null, { status: 204, statusText: 'No Content' });

      expect(auth.isAdmin()).toBe(false);
      expect(auth.editMode()).toBe(false);
    });

    it('ends the session even when the server never answers', () => {
      auth.logout().subscribe();
      http.expectOne(`${BASE}/logout`).flush({}, { status: 500, statusText: 'Server Error' });

      expect(auth.isAdmin()).toBe(false);
      expect(auth.editMode()).toBe(false);
    });
  });
});
