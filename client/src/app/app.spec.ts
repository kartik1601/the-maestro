import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { AuthService } from './core/auth.service';
import { SECTION_META } from './core/models';
import { resetMediaQueries, setMediaQuery } from '../testing/setup';

const REPOSITORY = 'https://github.com/kartik1601/the-maestro';

describe('App', () => {
  let fixture: Awaited<ReturnType<typeof render>>;

  async function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });

    const created = TestBed.createComponent(App);
    await created.whenStable();
    return created;
  }

  const html = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    resetMediaQueries();
    localStorage.clear();
    fixture = await render();
  });

  it('creates', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  describe('navigation', () => {
    it('links to every section, in the order they are declared', () => {
      const links = [...html().querySelectorAll('.nav__link')].map((link) =>
        link.textContent?.trim(),
      );
      expect(links).toEqual(SECTION_META.map((section) => section.label));
    });

    it('points each link at its route', () => {
      const hrefs = [...html().querySelectorAll('.nav__link')].map((link) =>
        link.getAttribute('href'),
      );
      expect(hrefs).toEqual(SECTION_META.map((section) => section.path));
    });

    it('never links to the admin portal', () => {
      expect(html().innerHTML).not.toContain('portal');
    });
  });

  describe('the GitHub link', () => {
    const link = () => html().querySelector<HTMLAnchorElement>(`a[href="${REPOSITORY}"]`);

    it('is in the masthead', () => {
      expect(link()).not.toBeNull();
      expect(link()?.closest('.masthead__actions')).not.toBeNull();
    });

    it('opens in a new tab without handing over the opener', () => {
      expect(link()?.getAttribute('target')).toBe('_blank');
      expect(link()?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('carries a label, since it is a mark rather than words', () => {
      expect(link()?.getAttribute('aria-label')).toBe("This project's source on GitHub");
      expect(link()?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('takes the icon-button treatment beside the theme toggle', () => {
      expect(link()?.classList.contains('icon-btn')).toBe(true);
    });
  });

  describe('the theme toggle', () => {
    const button = () =>
      html().querySelector<HTMLButtonElement>('.masthead__actions button.icon-btn');

    it('offers the theme the reader is not already in', async () => {
      setMediaQuery('(prefers-color-scheme: dark)', false);
      fixture = await render();

      expect(button()?.getAttribute('aria-label')).toBe('Switch to dark theme');

      button()?.click();
      await fixture.whenStable();
      expect(button()?.getAttribute('aria-label')).toBe('Switch to light theme');
    });
  });

  describe('the sections menu', () => {
    const toggle = () => html().querySelector<HTMLButtonElement>('.nav-toggle');

    it('starts closed', () => {
      expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
      expect(html().querySelector('.nav--open')).toBeNull();
    });

    it('opens and closes on the toggle', async () => {
      toggle()?.click();
      await fixture.whenStable();
      expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
      expect(html().querySelector('.nav--open')).not.toBeNull();

      toggle()?.click();
      await fixture.whenStable();
      expect(html().querySelector('.nav--open')).toBeNull();
    });
  });

  describe('the fission mark', () => {
    const mark = () => html().querySelector<HTMLButtonElement>('.brand__element');

    it('is not a link, so watching it unfold never navigates away', () => {
      expect(mark()?.tagName).toBe('BUTTON');
      expect(mark()?.closest('a')).toBeNull();
    });

    it('opens the panel on a touch screen', async () => {
      setMediaQuery('(hover: hover) and (pointer: fine)', false);

      mark()?.click();
      await fixture.whenStable();
      expect(html().querySelector('.reaction-panel')).not.toBeNull();
    });

    it('stays inline where a pointer can hover it', async () => {
      setMediaQuery('(hover: hover) and (pointer: fine)', true);

      mark()?.click();
      await fixture.whenStable();
      expect(html().querySelector('.reaction-panel')).toBeNull();
    });

    it('closes on Escape', async () => {
      setMediaQuery('(hover: hover) and (pointer: fine)', false);
      mark()?.click();
      await fixture.whenStable();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await fixture.whenStable();
      expect(html().querySelector('.reaction-panel')).toBeNull();
    });
  });

  describe('the author bar', () => {
    /** Puts a session in place without going near the network. */
    const signIn = async () => {
      const auth = TestBed.inject(AuthService);
      auth.login({ username: 'u', password: 'p', authKey: 'k' }).subscribe();
      TestBed.inject(HttpTestingController)
        .expectOne((request) => request.url.endsWith('/login'))
        .flush({ accessToken: 'a.b.c', admin: { displayName: 'Kartik' } });

      await fixture.whenStable();
      return auth;
    };

    it('is invisible to a reader', () => {
      expect(html().querySelector('.author-bar')).toBeNull();
    });

    it('names the author once signed in', async () => {
      await signIn();

      expect(html().querySelector('.author-bar')).not.toBeNull();
      expect(html().querySelector('.author-bar__who')?.textContent).toContain('Kartik');
    });

    it('rests in preview, so the author sees the site as a visitor does', async () => {
      await signIn();
      expect(html().querySelector('.author-bar__mode')?.textContent?.trim()).toBe('Preview');
    });

    it('enters and leaves editing deliberately', async () => {
      const auth = await signIn();

      html().querySelector<HTMLButtonElement>('.author-bar .btn--primary')?.click();
      await fixture.whenStable();
      expect(auth.editMode()).toBe(true);
      expect(html().querySelector('.author-bar__mode')?.textContent?.trim()).toBe('Editing');

      html().querySelector<HTMLButtonElement>('.author-bar .btn--ghost')?.click();
      await fixture.whenStable();
      expect(auth.editMode()).toBe(false);
    });
  });
});
