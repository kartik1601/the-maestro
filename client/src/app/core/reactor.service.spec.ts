import { TestBed } from '@angular/core/testing';
import { ReactorService } from './reactor.service';

const STORAGE_KEY = 'maestro.reactor-id';

describe('ReactorService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  const create = () => TestBed.inject(ReactorService);

  it('mints an id on the first visit and keeps it', () => {
    const id = create().id;

    expect(id).toMatch(/^r-/);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(id);
  });

  it('reuses the id a returning visitor already has', () => {
    localStorage.setItem(STORAGE_KEY, 'r-an-existing-visitor');
    expect(create().id).toBe('r-an-existing-visitor');
  });

  it('replaces a stored value too short to be an id', () => {
    localStorage.setItem(STORAGE_KEY, 'tiny');
    const id = create().id;

    expect(id).not.toBe('tiny');
    expect(id.length).toBeGreaterThanOrEqual(8);
  });

  it('is long enough for the server to accept', () => {
    // The API takes 8–128 characters; anything else is treated as no id at all.
    const { id } = create();
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id.length).toBeLessThanOrEqual(128);
  });

  it('still yields an id when storage is unavailable', () => {
    const broken = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(create().id).toMatch(/^r-/);
    broken.mockRestore();
  });
});
