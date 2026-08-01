import { Component, input, output } from '@angular/core';

/**
 * The git-style "changes upstream" indicator. Appears only when the author has
 * edited what the reader is looking at, and never reloads anything on its own —
 * pulling a page out from under someone mid-sentence is worse than being slightly
 * out of date.
 */
@Component({
  selector: 'app-refresh-pill',
  template: `
    @if (visible()) {
      <button class="pill" type="button" (click)="refresh.emit()" [disabled]="busy()">
        <span class="pill__icon" aria-hidden="true">⟳</span>
        <span>{{ busy() ? 'Updating…' : label() }}</span>
      </button>
    }
  `,
  styles: `
    /*
     * The host is a zero-height overlay so the bar floats above the page without
     * pushing it down. Alignment is load-bearing here: the default stretch would
     * size the button to the host's own zero height and crush its content box to
     * nothing, so the button opts out with align-self below.
     */
    :host {
      position: sticky;
      inset-block-start: calc(var(--header-height) + var(--space-3));
      z-index: 30;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      pointer-events: none;
      height: 0;
    }

    /**
     * A solid amber bar, the way GitHub announces new commits upstream — an
     * unmissable block rather than an outlined chip. The colour is fixed rather than
     * themed: this is a notice, and it should look identical in light and dark.
     */
    .pill {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      /* Without this the zero-height host stretches the button and flattens it. */
      align-self: flex-start;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-5);
      border: 1px solid #d4a017;
      border-radius: var(--radius-sm);
      background: #f5c518;
      color: #1b1d20;
      font-size: var(--text-base);
      font-weight: 600;
      letter-spacing: 0.01em;
      box-shadow: var(--shadow-lg);
      animation: pill-in var(--duration-base) var(--ease-out) both;

      &:hover:not(:disabled) {
        background: #ffd33d;
      }

      &:disabled {
        opacity: 0.85;
        cursor: default;
      }
    }

    .pill__icon {
      display: grid;
      place-items: center;
      width: 1.4rem;
      height: 1.4rem;
      border-radius: var(--radius-sm);
      background: rgb(27 29 32 / 12%);
      font-size: var(--text-lg);
      line-height: 1;
    }

    /* Spins only while fetching, so the icon reads as a state and not decoration. */
    .pill:disabled .pill__icon {
      animation: spin 900ms linear infinite;
    }

    @keyframes pill-in {
      from {
        opacity: 0;
        transform: translateY(-8px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
})
export class RefreshPillComponent {
  readonly visible = input(false);
  readonly busy = input(false);
  readonly label = input('New changes — refresh');

  readonly refresh = output<void>();
}
