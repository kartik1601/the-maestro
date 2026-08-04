import { environment } from '../../environments/environment';

/**
 * How a media reference is stored, and how it is displayed.
 *
 * **Documents always store the relative form**, `/api/media/<id>`. That is what makes
 * a poem written on a laptop readable on the deployed site: the same HTML resolves
 * against whichever origin is serving it. Storing what the browser needed at the time
 * of writing would pin every file to the machine that uploaded it — in development
 * that is `http://localhost:4000`, which exists for nobody else.
 *
 * The absolute form is produced at render time and never written back.
 */

/** Matches a media reference against any host, or none. */
const MEDIA_REFERENCE = /^(?:https?:\/\/[^/]+)?(\/api\/media\/[a-f\d]{24}(?:\?[^"']*)?)$/i;

/** The origin the API is served from — empty in production, where it shares ours. */
const apiOrigin = () => {
  const base = environment.apiBase.replace(/\/api\/?$/, '');
  return /^https?:\/\//.test(base) ? base : '';
};

/**
 * The form to store: relative, whatever the caller was handed.
 *
 * Applied on the way *into* a document, so authoring locally cannot bake a localhost
 * address into content that will later be served from the real site.
 */
export function toStoredMediaUrl(url: string): string {
  return String(url ?? '').replace(MEDIA_REFERENCE, '$1');
}

/**
 * The form to display. A no-op in production, where the site and the API share an
 * origin and the stored path already resolves. In development it gains the API's
 * origin, because the site is on another port and would otherwise ask itself.
 */
export function resolveMediaUrl(url: string): string {
  const value = String(url ?? '');
  if (/^https?:\/\//.test(value)) return value;
  return value.startsWith('/api/') ? apiOrigin() + value : value;
}

/**
 * Rewrites every media reference in a block of authored HTML for display.
 *
 * One choke point for the whole site: images, audio, anything else that carries a
 * media path. Returns the input untouched in production, where there is no origin to
 * add — so the cost outside development is a single regex that matches nothing.
 */
export function resolveMediaUrlsIn(html: string): string {
  const origin = apiOrigin();
  if (!origin) return html;

  return html.replace(/(\s(?:src|data-audio)=")\/api\/media\//g, `$1${origin}/api/media/`);
}
