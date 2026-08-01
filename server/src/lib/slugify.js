/**
 * URL-safe slug. Decomposes accents first so "Bellore" and "Bellorè" do not collide
 * with different bytes, and preserves digits so "uranium-235" keeps its 235.
 */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}
