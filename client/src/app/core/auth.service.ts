import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../environments/environment';

interface AuthResponse {
  accessToken: string;
  admin: { displayName: string };
}

export interface Credentials {
  username: string;
  password: string;
  authKey: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBase}/${environment.adminPortalPath}/auth`;

  /**
   * The access token is held in memory only. Putting it in localStorage would make
   * it readable by any script on the page; the refresh token lives in an httpOnly
   * cookie the browser will not hand to JavaScript, and restores the session on reload.
   */
  private readonly accessToken = signal<string | null>(null);
  private readonly displayName = signal<string | null>(null);
  private readonly expiresAt = signal<number | null>(null);

  readonly isAdmin = computed(() => this.accessToken() !== null);
  readonly adminName = this.displayName.asReadonly();

  /** Epoch milliseconds at which the current access token lapses, if any. */
  readonly accessTokenExpiry = this.expiresAt.asReadonly();

  /**
   * When true, the author is editing rather than reading. Every editable surface
   * watches this rather than `isAdmin`, so the author can preview the site exactly
   * as a visitor sees it without logging out.
   */
  readonly editMode = signal(false);

  private restoring?: Observable<boolean>;


  token(): string | null {
    return this.accessToken();
  }

  login(credentials: Credentials): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.base}/login`, credentials, { withCredentials: true })
      .pipe(tap((response) => this.accept(response)));
  }

  /**
   * Exchanges the refresh cookie for a new access token, resolving to whether the
   * session survived. Shared so a burst of concurrent 401s triggers exactly one
   * refresh instead of a stampede; the in-flight observable is released on
   * completion so the next expiry starts fresh.
   */
  refresh(): Observable<boolean> {
    this.restoring ??= this.http
      .post<AuthResponse>(`${this.base}/refresh`, {}, { withCredentials: true })
      .pipe(
        map((response) => {
          this.accept(response);
          return true;
        }),
        catchError(() => {
          this.clear();
          return of(false);
        }),
        finalize(() => (this.restoring = undefined)),
        shareReplay({ bufferSize: 1, refCount: true }),
      );

    return this.restoring;
  }

  /** Called once at startup so a returning author lands already signed in. */
  restoreSession(): Observable<boolean> {
    return this.refresh();
  }

  logout(): Observable<unknown> {
    return this.http.post(`${this.base}/logout`, {}, { withCredentials: true }).pipe(
      tap(() => this.clear()),
      catchError(() => {
        // The local session ends regardless of whether the server acknowledged it.
        this.clear();
        return of(null);
      }),
    );
  }

  private accept(response: AuthResponse): void {
    this.accessToken.set(response.accessToken);
    this.displayName.set(response.admin?.displayName ?? 'The Author');
    this.expiresAt.set(expiryOf(response.accessToken));
  }

  private clear(): void {
    this.accessToken.set(null);
    this.displayName.set(null);
    this.expiresAt.set(null);
    this.editMode.set(false);
  }
}

/**
 * Reads the `exp` claim so the session guard knows when to offer a renewal.
 *
 * This is not verification — the signature is the server's business, and this token
 * came from the server over HTTPS. It only needs the timestamp, so a malformed token
 * simply yields null and the guard stays quiet.
 */
function expiryOf(token: string): number | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;

    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = JSON.parse(json)?.exp;

    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}
