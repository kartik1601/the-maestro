import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../environments/environment';

export type LetterState =
  | 'off'
  | 'open'
  | 'email'
  | 'otp'
  | 'cooldown'
  | 'blocked'
  | 'unlocked';

export interface LetterStatus {
  state: LetterState;
  /** ISO time the current wait or block ends. */
  retryAt?: string;
  /** Wrong answers this address has left before a day's block. */
  triesLeft?: number;
  /** Tries left on the author's bypass code. */
  otpTriesLeft?: number;
  /** Present only on `unlocked`. */
  token?: string;
  /** Set when the Gmail given for a code was not an address. */
  error?: 'email';
}

export interface LetterAnswers {
  name: string;
  privateHandle: string;
  publicHandle: string;
  /** `YYYY-MM-DD`, straight from the date input. */
  dob: string;
}

export interface LetterContent {
  greetings: string[];
  /** A short-lived token that opens the video, or null while there is none. */
  video: { token: string } | null;
}

const NEVER_KEY = 'maestro.letter.never';

/**
 * The letter on the Blogs page. Every rule — the wait, the strikes, the block — is
 * the server's; this only carries answers there and remembers what the reader chose
 * to do with the modal.
 */
@Injectable({ providedIn: 'root' })
export class LetterService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBase}/letter`;

  /**
   * Closed for this visit. Held in memory, so moving between sections does not bring
   * it back but a reload or a new visit does.
   */
  readonly dismissed = signal(false);

  /** The token from a successful unlock. Kept only in memory, like the letter. */
  readonly token = signal<string | null>(null);

  /** "Never show again" — this browser, for good. */
  get neverShow(): boolean {
    try {
      return localStorage.getItem(NEVER_KEY) === '1';
    } catch {
      return false;
    }
  }

  setNeverShow(): void {
    try {
      localStorage.setItem(NEVER_KEY, '1');
    } catch {
      // Storage refused (a private window): it still closes for this visit.
    }
    this.dismissed.set(true);
  }

  /** Whether to raise the modal at all. Any failure is treated as "no". */
  shouldOffer(): Observable<LetterStatus | null> {
    if (this.neverShow || this.dismissed()) return of(null);

    return this.http.get<LetterStatus>(`${this.base}/status`).pipe(
      map((status) => (status.state === 'off' || status.state === 'blocked' ? null : status)),
      catchError(() => of(null)),
    );
  }

  unlock(answers: LetterAnswers): Observable<LetterStatus> {
    return this.http.post<LetterStatus>(`${this.base}/unlock`, answers);
  }

  /** Leaves the reader's Gmail; the author is mailed it with a code. */
  requestOtp(email: string): Observable<LetterStatus> {
    return this.http.post<LetterStatus>(`${this.base}/request-otp`, { email });
  }

  redeem(code: string): Observable<LetterStatus> {
    return this.http.post<LetterStatus>(`${this.base}/otp`, { code });
  }

  /** The video's address. It carries its own token: a <video> cannot send headers. */
  videoUrl(token: string, quality: 'hd' | 'sd'): string {
    return `${this.base}/video/${quality}?t=${encodeURIComponent(token)}`;
  }

  content(): Observable<LetterContent> {
    return this.http.get<LetterContent>(`${this.base}/content`, {
      headers: { 'X-Letter-Token': this.token() ?? '' },
    });
  }
}

/** "14 minutes", "1 minute" — never "0 minutes" while any wait remains. */
export function minutesUntil(retryAt: string | undefined, now = Date.now()): string {
  const ms = retryAt ? new Date(retryAt).getTime() - now : 0;
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes >= 90) {
    const hours = Math.ceil(minutes / 60);
    return `${hours} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}
