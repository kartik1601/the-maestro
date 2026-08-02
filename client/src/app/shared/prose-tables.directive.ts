import { AfterViewChecked, Directive, ElementRef, inject } from '@angular/core';

/**
 * Gives every table in authored prose its own horizontal scroll container.
 *
 * A table cannot be made narrow without destroying it — columns are the point, and a
 * four-column table of any substance is wider than a phone. The alternatives are to
 * let it push the whole page sideways, or to reflow it into stacked rows that no
 * longer line up as a table. Neither is right for an archive whose tables are part of
 * the writing, so the table keeps its true width and scrolls inside the column instead.
 *
 * Done here rather than in CSS because the only pure-CSS route is `display: block` on
 * the table itself, which drops it out of table layout and takes the column sizing
 * with it. A wrapper element keeps the table a table.
 *
 * The markup arrives through `[innerHTML]` after Angular has finished with it, so the
 * work happens on every check and is guarded by a marker attribute rather than run
 * once — the same approach as the YouTube facades, and for the same reason.
 */
@Directive({
  selector: '[appProseTables]',
})
export class ProseTablesDirective implements AfterViewChecked {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngAfterViewChecked(): void {
    const tables = this.host.nativeElement.querySelectorAll<HTMLTableElement>(
      'table:not([data-scroll-wrapped])',
    );

    for (const table of Array.from(tables)) {
      table.setAttribute('data-scroll-wrapped', '');

      // Re-entering an already wrapped table would nest wrappers on every pass.
      if (table.parentElement?.classList.contains('table-scroll')) continue;

      const wrapper = document.createElement('div');
      wrapper.className = 'table-scroll';

      /**
       * A scrollable region is only reachable by keyboard if something in it can take
       * focus. Tables hold no controls, so the wrapper takes focus itself — and needs
       * a name and a role to explain what it is once it does.
       */
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', 'Table, scrollable');

      table.replaceWith(wrapper);
      wrapper.append(table);
    }
  }
}
