import { environment } from '../../environments/environment';
import { resolveMediaUrl, resolveMediaUrlsIn, toStoredMediaUrl } from './media-url';

/**
 * These read `environment.apiBase` at call time, so a spec can describe either
 * deployment: development, where the API is on another port, and production, where it
 * shares the site's origin.
 */
const ID = '507f1f77bcf86cd799439011';
const original = environment.apiBase;

const asDevelopment = () => (environment.apiBase = 'http://localhost:4000/api');
const asProduction = () => (environment.apiBase = '/api');

afterEach(() => {
  environment.apiBase = original;
});

describe('toStoredMediaUrl', () => {
  beforeEach(asDevelopment);

  it('strips the host from a media reference so it is portable', () => {
    expect(toStoredMediaUrl(`http://localhost:4000/api/media/${ID}`)).toBe(`/api/media/${ID}`);
    expect(toStoredMediaUrl(`https://themaestro.co.in/api/media/${ID}`)).toBe(`/api/media/${ID}`);
  });

  it('leaves an already-relative reference alone', () => {
    expect(toStoredMediaUrl(`/api/media/${ID}`)).toBe(`/api/media/${ID}`);
  });

  it('keeps a query string', () => {
    expect(toStoredMediaUrl(`http://localhost:4000/api/media/${ID}?download=1`)).toBe(
      `/api/media/${ID}?download=1`,
    );
  });

  it('does not touch a URL that is not a media reference', () => {
    expect(toStoredMediaUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe(
      'https://i.ytimg.com/vi/abc/hqdefault.jpg',
    );
  });

  it('survives null and undefined', () => {
    expect(toStoredMediaUrl(null as unknown as string)).toBe('');
    expect(toStoredMediaUrl(undefined as unknown as string)).toBe('');
  });
});

describe('resolveMediaUrl', () => {
  it('adds the API origin in development, where the site is on another port', () => {
    asDevelopment();
    expect(resolveMediaUrl(`/api/media/${ID}`)).toBe(`http://localhost:4000/api/media/${ID}`);
  });

  it('is a no-op in production, where the path already resolves', () => {
    asProduction();
    expect(resolveMediaUrl(`/api/media/${ID}`)).toBe(`/api/media/${ID}`);
  });

  it('leaves an absolute URL untouched', () => {
    asDevelopment();
    expect(resolveMediaUrl('https://example.com/x.png')).toBe('https://example.com/x.png');
  });

  it('leaves a path that is not an API path untouched', () => {
    asDevelopment();
    expect(resolveMediaUrl('/assets/photo.png')).toBe('/assets/photo.png');
  });
});

describe('resolveMediaUrlsIn', () => {
  it('rewrites every image and audio reference in a body', () => {
    asDevelopment();
    const html = `<p><img src="/api/media/${ID}"><div data-audio="/api/media/${ID}"></div></p>`;

    expect(resolveMediaUrlsIn(html)).toBe(
      `<p><img src="http://localhost:4000/api/media/${ID}">` +
        `<div data-audio="http://localhost:4000/api/media/${ID}"></div></p>`,
    );
  });

  it('returns the body untouched in production', () => {
    asProduction();
    const html = `<img src="/api/media/${ID}">`;
    expect(resolveMediaUrlsIn(html)).toBe(html);
  });

  it('leaves references that already carry a host alone', () => {
    asDevelopment();
    const html = '<img src="https://cdn.example.com/api/media/x">';
    expect(resolveMediaUrlsIn(html)).toBe(html);
  });
});
