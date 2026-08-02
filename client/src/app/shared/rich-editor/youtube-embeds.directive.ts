import { AfterViewChecked, Directive, ElementRef, inject } from '@angular/core';

const ID_PATTERN = /^[\w-]{11}$/;

/**
 * Turns the `<div data-youtube="ID">` placeholders in authored prose into players.
 *
 * A facade rather than an iframe on load: a page with several videos would otherwise
 * pull megabytes of YouTube's player for videos nobody may watch, and would hand
 * every reader a tracking cookie on arrival. The thumbnail is a plain image; the real
 * player — with its full controls — is only mounted once a reader presses play.
 *
 * The id is re-validated here even though it was validated on the way in. This
 * element ends up in a URL, and the cost of checking again is a regex.
 */
@Directive({
  selector: '[appYouTubeEmbeds]',
})
export class YouTubeEmbedsDirective implements AfterViewChecked {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngAfterViewChecked(): void {
    const blocks = this.host.nativeElement.querySelectorAll<HTMLElement>(
      'div[data-youtube]:not([data-mounted])',
    );

    for (const block of Array.from(blocks)) {
      block.setAttribute('data-mounted', '');
      this.mount(block);
    }
  }

  private mount(block: HTMLElement): void {
    const id = block.getAttribute('data-youtube') ?? '';
    if (!ID_PATTERN.test(id)) {
      block.remove();
      return;
    }

    const title = block.getAttribute('data-title') ?? 'YouTube video';

    block.classList.add('yt');
    block.textContent = '';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'yt__facade';
    button.setAttribute('aria-label', `Play ${title}`);

    const thumbnail = document.createElement('img');
    thumbnail.className = 'yt__thumb';
    thumbnail.loading = 'lazy';
    thumbnail.alt = '';
    thumbnail.src = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
    // Not every video has a maxres still; hqdefault always exists.
    thumbnail.onerror = () => {
      thumbnail.onerror = null;
      thumbnail.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    };

    const play = document.createElement('span');
    play.className = 'yt__play';
    play.setAttribute('aria-hidden', 'true');
    play.textContent = '▶';

    button.append(thumbnail, play);
    if (title) {
      const caption = document.createElement('span');
      caption.className = 'yt__title';
      caption.textContent = title;
      button.append(caption);
    }

    button.addEventListener('click', () => {
      const frame = document.createElement('iframe');
      // nocookie host, and autoplay because the reader just asked for it.
      frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      frame.title = title;
      frame.className = 'yt__frame';
      frame.allow =
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';

      block.textContent = '';
      block.append(frame);
    });

    block.append(button);
  }
}
