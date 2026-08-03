import 'dotenv/config';
import crypto from 'node:crypto';

/**
 * Every tunable lives here so `.claude/API_KEYS.md` has exactly one source of truth
 * to document. Nothing else in the codebase reads `process.env` directly.
 */

const bool = (value, fallback) =>
  value === undefined ? fallback : /^(1|true|yes|on)$/i.test(value);

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Secrets are required in production but auto-generated in development so the
 * prototype boots with zero configuration. An ephemeral secret means every
 * restart invalidates outstanding tokens, which is fine locally and unacceptable
 * in production — hence the hard failure below.
 */
const ephemeral = (name) => {
  const generated = crypto.randomBytes(48).toString('hex');
  ephemeralSecrets.add(name);
  return generated;
};
const ephemeralSecrets = new Set();

const cookieSameSite = (process.env.COOKIE_SAMESITE ?? 'lax').toLowerCase();

// Read out here because `seedOnBoot` below is derived from it, and a property of an
// object literal cannot reference a sibling while the literal is still being built.
const mongoUri = process.env.MONGODB_URI ?? '';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  get isProduction() {
    return this.nodeEnv === 'production';
  },

  port: int(process.env.PORT, 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:4200',

  /**
   * The refresh cookie has to survive the site and the API living apart.
   *
   * `lax` is correct whenever they share a registrable domain — api.themaestro.co.in
   * and www.themaestro.co.in are the same site, so the cookie still travels and the
   * CSRF protection `lax` buys is kept. Put the API on a different site, such as a
   * raw onrender.com URL, and the login request becomes cross-site: browsers then
   * send no cookie at all unless it is `none`, and reject `none` unless it is also
   * Secure. Hence the pairing below and the guard at the foot of this file.
   */
  cookies: {
    sameSite: cookieSameSite,
    secure: (process.env.NODE_ENV ?? 'development') === 'production' || cookieSameSite === 'none',
  },

  // Absent in development -> an in-process MongoDB is started instead (see db/connect.js).
  mongoUri,
  mongoDbName: process.env.MONGODB_DB_NAME ?? 'the_maestro',

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? ephemeral('JWT_ACCESS_SECRET'),
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? ephemeral('JWT_REFRESH_SECRET'),
    // Three hours: long enough to write a chapter without being interrupted. The
    // refresh token still rotates, so a stolen access token has a bounded life.
    accessTtl: process.env.JWT_ACCESS_TTL ?? '3h',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    issuer: 'the-maestro',
    audience: 'the-maestro-admin',
  },

  /**
   * The admin surface is mounted under this unguessable segment. A request to any
   * other path never learns that an admin API exists — see routes/admin-gate.js.
   */
  adminPortalPath: process.env.ADMIN_PORTAL_PATH ?? 'portal-dev-only',

  /**
   * Development-only convenience: if no admin exists yet AND all three factors are
   * supplied here, one is provisioned and the credentials are echoed to the terminal.
   *
   * Deliberately undefaulted. Shipping fallback credentials in a public repository
   * means every clone boots with the same known admin at the same known portal path —
   * so an unset factor provisions nothing and the server says how to fix it. In
   * production the author is provisioned once via `npm run admin:create`.
   */
  bootstrapAdmin: {
    displayName: process.env.ADMIN_DISPLAY_NAME ?? 'The Author',
    username: process.env.ADMIN_USERNAME ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
    authKey: process.env.ADMIN_AUTH_KEY ?? '',
  },

  /**
   * Cloudflare R2. Leave any of these empty and uploads fall back to storing bytes
   * inside MongoDB, which keeps a fresh clone working with no account anywhere.
   * See .claude/API_KEYS.md for how to obtain each value.
   */
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    bucket: process.env.R2_BUCKET ?? '',

    /**
     * A public hostname for the bucket — an r2.dev subdomain or a custom domain.
     * Optional: without it every object is served through a signed URL instead,
     * which works but bypasses CDN caching.
     */
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? '',

    signedUrlTtl: int(process.env.R2_SIGNED_URL_TTL, 60 * 60),
  },

  uploads: {
    // MongoDB caps a single BSON document at 16 MB; Buffer-in-document storage
    // must stay clear of that ceiling. See .claude/MEMORY.md for the GridFS path.
    maxPdfBytes: int(process.env.MAX_PDF_BYTES, 15 * 1024 * 1024),

    // Images sit inside prose, so the ceiling is about page weight rather than BSON.
    maxImageBytes: int(process.env.MAX_IMAGE_BYTES, 8 * 1024 * 1024),
  },

  /**
   * Automatic only for the throwaway in-process database, which starts empty on every
   * boot and would otherwise leave a fresh clone with nothing to look at.
   *
   * A real MONGODB_URI is somebody's actual archive, and the seeder is not as harmless
   * against one as it looks. Its upserts are keyed on (section, slug), so a work the
   * author has since renamed no longer matches its template row and gets re-inserted as
   * a placeholder alongside the real one — which is exactly how the sample poems kept
   * reappearing under Rains of Love after every `npm run dev`. Filling a genuinely new
   * database is a deliberate, one-off act: `npm run seed`, or SEED_ON_BOOT=true.
   */
  seedOnBoot: bool(process.env.SEED_ON_BOOT, !mongoUri),
};

export const ephemeralSecretNames = () => [...ephemeralSecrets];

if (env.isProduction && ephemeralSecrets.size > 0) {
  throw new Error(
    `Refusing to start in production with generated secrets: ${[...ephemeralSecrets].join(', ')}. ` +
      'Set them explicitly — see .claude/API_KEYS.md.',
  );
}

if (env.isProduction && env.adminPortalPath === 'portal-dev-only') {
  throw new Error('ADMIN_PORTAL_PATH must be set to a private value in production.');
}

if (!['lax', 'strict', 'none'].includes(cookieSameSite)) {
  throw new Error(`COOKIE_SAMESITE must be lax, strict or none — got '${cookieSameSite}'.`);
}

// `none` forces Secure above, and a Secure cookie over plain HTTP is discarded: the
// login returns 200 and the session is gone by the next request. Only a warning, since
// a development server fronted by an HTTPS tunnel is a legitimate reason to set this.
if (cookieSameSite === 'none' && !env.isProduction) {
  console.warn(
    '[env] COOKIE_SAMESITE=none needs HTTPS — over plain http:// the browser will ' +
      'drop the refresh cookie and admin sessions will not survive a reload.',
  );
}
