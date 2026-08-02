import mongoose from 'mongoose';
import { env } from '../config/env.js';

let memoryServer = null;

/**
 * Two modes, one code path:
 *   - MONGODB_URI set   -> connect to it (MongoDB Atlas M0 in this project).
 *   - MONGODB_URI unset -> boot an in-process MongoDB so the prototype runs with
 *     no account, no install, and no network. Data is discarded on exit.
 *
 * Both modes are real MongoDB speaking the real wire protocol, so nothing in the
 * application layer needs to know which one it got.
 */
export async function connectDatabase() {
  let uri = env.mongoUri;
  let mode = 'atlas';

  if (!uri) {
    if (env.isProduction) {
      throw new Error('MONGODB_URI is required in production — see .claude/API_KEYS.md.');
    }
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create({ instance: { dbName: env.mongoDbName } });
    uri = memoryServer.getUri();
    mode = 'in-memory';
  }

  mongoose.set('strictQuery', true);

  await connectWithRetry(uri);

  return { mode, uri };
}

/**
 * An `mongodb+srv://` URI makes the driver resolve SRV and TXT records before it can
 * connect at all, and those lookups fail intermittently on some networks (ESERVFAIL)
 * even when the records resolve perfectly a second later. A cold start should not
 * depend on winning that race, so transient resolution and selection failures are
 * retried with backoff.
 */
async function connectWithRetry(uri, attempts = 7) {
  const transient = new Set([
    'ESERVFAIL',
    'EAI_AGAIN',
    'ETIMEOUT',
    'ETIMEDOUT',
    'ECONNRESET',
    'ENOTFOUND',
  ]);

  for (let attempt = 1; ; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        dbName: env.mongoDbName,
        serverSelectionTimeoutMS: 15_000,
      });
      return;
    } catch (error) {
      const retryable =
        transient.has(error?.code) ||
        error?.name === 'MongoServerSelectionError' ||
        /querySrv|queryTxt/.test(error?.syscall ?? '');

      if (!retryable || attempt >= attempts) throw error;

      // Capped exponential backoff: ~0.5s, 1s, 2s, 4s, 8s, 8s — around 24 seconds of
      // patience in total. SRV lookups on this network have failed for that long.
      const waitMs = Math.min(500 * 2 ** (attempt - 1), 8000);
      console.warn(
        `[db] connection attempt ${attempt} failed (${error.code ?? error.name}) — retrying in ${waitMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

export async function disconnectDatabase() {
  await mongoose.connection.close();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

export const isEphemeralDatabase = () => memoryServer !== null;
