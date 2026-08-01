import { Injectable } from '@angular/core';

const STORAGE_KEY = 'maestro.reactor-id';

/**
 * The least identity that still lets a visitor take back their own reaction.
 *
 * A random id in localStorage — no account, no cookie, no fingerprint, nothing sent
 * anywhere except alongside a reaction. Clearing site data resets it, which only
 * means the reader can react again; nothing is lost.
 */
@Injectable({ providedIn: 'root' })
export class ReactorService {
  readonly id = this.load();

  private load(): string {
    try {
      const existing = localStorage.getItem(STORAGE_KEY);
      if (existing && existing.length >= 8) return existing;

      const minted = `r-${crypto.randomUUID()}`;
      localStorage.setItem(STORAGE_KEY, minted);
      return minted;
    } catch {
      // Private browsing with storage disabled: reactions still register, they just
      // cannot be un-done after a reload.
      return `r-${crypto.randomUUID()}`;
    }
  }
}
