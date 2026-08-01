import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <section class="missing shell">
      <p class="eyebrow rise">404</p>
      <h1 class="missing__title rise">There is nothing written here.</h1>
      <p class="missing__note rise">Not yet, anyway.</p>
      <a class="btn btn--ghost rise" routerLink="/">Back to the beginning</a>
    </section>
  `,
  styles: `
    .missing {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-4);
      padding-block: var(--space-9);
      text-align: center;
    }

    .missing__title {
      font-size: clamp(var(--text-2xl), 5vw, var(--text-4xl));
      animation-delay: 60ms;
    }

    .missing__note {
      font-family: var(--font-serif);
      color: var(--text-muted);
      animation-delay: 120ms;
    }

    a {
      animation-delay: 180ms;
    }
  `,
})
export class NotFoundComponent {}
