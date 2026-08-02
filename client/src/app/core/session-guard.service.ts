import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { ModalService } from '../shared/modal/modal.service';

/** Prompt this long before the token actually lapses. */
const WARN_BEFORE_MS = 2 * 60 * 1000;
const CHECK_EVERY_MS = 30 * 1000;

/**
 * Keeps the author's session from lapsing underneath them.
 *
 * The access token is short-lived by design, and an expiry that lands mid-paragraph
 * would otherwise surface as a failed save. Shortly before it runs out this offers to
 * renew, and renewal is silent — the refresh cookie is exchanged for a fresh token
 * without leaving the page or losing anything typed.
 *
 * Only ever asks while there is a session to lose; a reader is never interrupted.
 */
@Injectable({ providedIn: 'root' })
export class SessionGuardService {
  private readonly auth = inject(AuthService);
  private readonly modal = inject(ModalService);
  private readonly destroyRef = inject(DestroyRef);

  private timer?: ReturnType<typeof setInterval>;
  private asking = false;

  constructor() {
    effect(() => {
      // Runs whenever the admin signs in or out.
      if (this.auth.isAdmin()) this.start();
      else this.stop();
    });

    this.destroyRef.onDestroy(() => this.stop());
  }

  private start(): void {
    this.stop();
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async check(): Promise<void> {
    if (this.asking) return;

    const expiresAt = this.auth.accessTokenExpiry();
    if (!expiresAt) return;

    const remaining = expiresAt - Date.now();
    if (remaining > WARN_BEFORE_MS) return;

    this.asking = true;
    try {
      const stay = await this.modal.confirm({
        title: 'Your session is about to end',
        message: this.auth.editMode()
          ? 'You are still editing. Continue the session to keep saving — nothing you have typed will be lost.'
          : 'Continue the session to stay signed in.',
        confirmLabel: 'Continue',
        cancelLabel: 'Sign out',
      });

      if (!stay) {
        this.auth.logout().subscribe();
        return;
      }

      const renewed = await new Promise<boolean>((resolve) =>
        this.auth.refresh().subscribe({
          next: resolve,
          error: () => resolve(false),
        }),
      );

      if (!renewed) {
        await this.modal.alert({
          title: 'Signed out',
          message: 'That session could not be renewed. Sign in again to keep editing.',
        });
      }
    } finally {
      this.asking = false;
    }
  }
}
