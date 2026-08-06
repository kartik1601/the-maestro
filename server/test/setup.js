/**
 * Preloaded before every test file (see the `test` script in package.json).
 *
 * `config/env.js` reads process.env once, at import time, so these have to be in
 * place before anything pulls it in. Setting them here rather than in the script
 * keeps the values next to the explanation of why each one is what it is.
 *
 * dotenv does not overwrite a variable that is already set, so a developer's real
 * `server/.env` — including a live MONGODB_URI — cannot leak into a test run.
 */

process.env.NODE_ENV = 'test';

// Never read: the harness connects to its own in-memory MongoDB. Set so that a
// stray `connectDatabase()` cannot reach somebody's actual archive.
process.env.MONGODB_URI = '';
process.env.MONGODB_DB_NAME = 'maestro_test';

// Fixed rather than generated, so a token minted in one test file verifies in another.
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

process.env.ADMIN_PORTAL_PATH = 'test-portal';
process.env.CLIENT_ORIGIN = 'http://localhost:4200';

// Nothing should be provisioned behind the tests' back.
process.env.ADMIN_USERNAME = '';
process.env.ADMIN_PASSWORD = '';
process.env.ADMIN_AUTH_KEY = '';
process.env.SEED_ON_BOOT = 'false';

// No bucket: uploads take the store-in-MongoDB path, which is what a fresh clone gets.
process.env.R2_ACCOUNT_ID = '';
process.env.R2_ACCESS_KEY_ID = '';
process.env.R2_SECRET_ACCESS_KEY = '';
process.env.R2_BUCKET = '';
