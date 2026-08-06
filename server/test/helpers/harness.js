import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * A real MongoDB and a real HTTP server for the API tests.
 *
 * In-process rather than mocked: the routes are thin, and almost everything worth
 * asserting about them — unique indexes, projections, sort order, the difference
 * between a draft and a published work — lives in the query rather than in the
 * handler. A stubbed Mongoose would test the stub.
 *
 * The env this imports must already be set by `test/setup.js`, which runs first.
 */

let memoryServer;
let server;

export async function startDatabase() {
  memoryServer = await MongoMemoryServer.create({ instance: { dbName: 'maestro_test' } });
  mongoose.set('strictQuery', true);
  await mongoose.connect(memoryServer.getUri(), { dbName: 'maestro_test' });
}

export async function stopDatabase() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await memoryServer?.stop();
}

/** Empties every collection between tests, so no test depends on another's leftovers. */
export async function clearDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}

/**
 * Boots the Express app on an ephemeral port and returns a small client.
 *
 * A real socket rather than an injected request object: cookies, status codes and
 * the CORS/helmet middleware stack are all part of what these tests describe, and a
 * fake request skips exactly the layer where those live.
 */
export async function startServer() {
  const { createApp } = await import('../../src/app.js');
  const app = createApp();

  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

export async function stopServer() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
}

/**
 * One request, with the bits every caller needs: JSON in and out, a bearer token, a
 * reactor id, and the cookie jar the refresh-token tests turn on.
 */
export async function request(baseUrl, method, path, options = {}) {
  const { body, token, reactorId, cookies, headers = {}, raw, ip } = options;

  const requestHeaders = { ...headers };
  if (body !== undefined && !raw) requestHeaders['content-type'] = 'application/json';
  if (token) requestHeaders['authorization'] = `Bearer ${token}`;
  if (reactorId) requestHeaders['x-reactor-id'] = reactorId;
  if (cookies) requestHeaders['cookie'] = cookies;
  /**
   * The app trusts one proxy hop, so this is what the rate limiter keys on. Every
   * request over loopback otherwise shares a single key, and the login limiter —
   * ten attempts per ten minutes — would start refusing tests partway through a
   * file. Tests that are about the limiter reuse one address on purpose.
   */
  if (ip) requestHeaders['x-forwarded-for'] = ip;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    redirect: 'manual',
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return {
    status: response.status,
    headers: response.headers,
    body: parsed,
    text,
    /** Just the `name=value` pairs, ready to send back on the next request. */
    cookies: setCookiePairs(response),
  };
}

function setCookiePairs(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((cookie) => cookie.split(';')[0]).join('; ');
}

/** Reads one attribute off a Set-Cookie header, for the flags the auth tests assert. */
export function cookieAttributes(response, name) {
  const raw = response.headers.getSetCookie?.() ?? [];
  const cookie = raw.find((value) => value.startsWith(`${name}=`));
  if (!cookie) return null;

  const [pair, ...attributes] = cookie.split(';').map((part) => part.trim());
  return {
    value: pair.slice(name.length + 1),
    attributes: Object.fromEntries(
      attributes.map((attribute) => {
        const [key, value = true] = attribute.split('=');
        return [key.toLowerCase(), value];
      }),
    ),
  };
}
