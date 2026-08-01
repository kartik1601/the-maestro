import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Renders author-written HTML with its formatting intact.
 *
 * Angular's default `[innerHTML]` sanitizer strips inline styles, which would
 * silently discard text alignment and colour the author chose in the editor. That
 * is safe to bypass here — and only here — because every one of these strings was
 * already run through `sanitize-html` on the server against a strict allow-list
 * before it was stored (see server/src/lib/sanitize.js). Nothing reaches this pipe
 * that has not been through that filter.
 *
 * Never point this at a string that came from anywhere but the content API.
 */
@Pipe({ name: 'authoredHtml' })
export class AuthoredHtmlPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(html: string | null | undefined): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html ?? '');
  }
}
