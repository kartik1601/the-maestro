import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';
import { resetMediaQueries, setMediaQuery } from '../../testing/setup';

const STORAGE_KEY = 'maestro.theme';
const DARK = '(prefers-color-scheme: dark)';

describe('ThemeService', () => {
  beforeEach(() => {
    resetMediaQueries();
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    TestBed.resetTestingModule();
  });

  const create = () => TestBed.inject(ThemeService);

  it('follows the operating system when nothing has been chosen', () => {
    setMediaQuery(DARK, true);
    expect(create().theme()).toBe('dark');
  });

  it('falls back to light when the system prefers light', () => {
    setMediaQuery(DARK, false);
    expect(create().theme()).toBe('light');
  });

  it('prefers an explicit past choice over the system', () => {
    setMediaQuery(DARK, true);
    localStorage.setItem(STORAGE_KEY, 'light');
    expect(create().theme()).toBe('light');
  });

  it('ignores a stored value that is not a theme', () => {
    setMediaQuery(DARK, true);
    localStorage.setItem(STORAGE_KEY, 'octarine');
    expect(create().theme()).toBe('dark');
  });

  it('toggles between the two themes', () => {
    setMediaQuery(DARK, false);
    const theme = create();

    theme.toggle();
    expect(theme.theme()).toBe('dark');
    theme.toggle();
    expect(theme.theme()).toBe('light');
  });

  it('stamps the choice on the document so the stylesheet can see it', () => {
    setMediaQuery(DARK, false);
    const theme = create();
    TestBed.tick();
    expect(document.documentElement.dataset['theme']).toBe('light');

    theme.toggle();
    TestBed.tick();
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('remembers the choice for the next visit', () => {
    setMediaQuery(DARK, false);
    create().toggle();
    TestBed.tick();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
  });
});
