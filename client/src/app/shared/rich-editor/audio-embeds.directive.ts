import { AfterViewChecked, Directive, ElementRef, inject } from '@angular/core';
import { resolveMediaUrl } from '../../core/media-url';
import { isOurMedia } from './audio';

/**
 * Turns the `<div data-audio="…">` placeholders in authored prose into players.
 *
 * Unlike the video facade next door there is nothing to defer here: an `<audio>`
 * element with `preload="metadata"` fetches a few kilobytes of header and stops, so
 * the reader gets a working transport bar without the recording arriving until it is
 * asked for. R2 answers byte ranges, which is what lets the reader seek into the
 * middle of a song without downloading the beginning of it.
 *
 * The source is re-validated even though it was validated on the way in — it ends up
 * as a URL, and checking again costs a regex.
 */
@Directive({
  selector: '[appAudioEmbeds]',
})
export class AudioEmbedsDirective implements AfterViewChecked {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngAfterViewChecked(): void {
    const blocks = this.host.nativeElement.querySelectorAll<HTMLElement>(
      'div[data-audio]:not([data-mounted])',
    );

    for (const block of Array.from(blocks)) {
      block.setAttribute('data-mounted', '');
      this.mount(block);
    }
  }

  private mount(block: HTMLElement): void {
    const src = block.getAttribute('data-audio') ?? '';
    if (!isOurMedia(src)) {
      block.remove();
      return;
    }

    const title = block.getAttribute('data-title') ?? '';

    block.classList.add('audio');
    block.textContent = '';

    if (title) {
      const caption = document.createElement('span');
      caption.className = 'audio__title';
      caption.textContent = title;
      block.append(caption);
    }

    const player = document.createElement('audio');
    player.className = 'audio__player';
    player.controls = true;
    player.preload = 'metadata';
    // Idempotent: the pipe has usually absolutized this already, and resolving an
    // absolute URL returns it unchanged. Kept so the directive is correct on its own.
    player.src = resolveMediaUrl(src);
    if (title) player.setAttribute('aria-label', title);

    block.append(player);
  }
}
