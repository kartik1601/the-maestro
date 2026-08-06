import { provisionAdmin } from '../../src/services/auth-service.js';
import { request } from './harness.js';

export const CREDENTIALS = {
  username: 'the-author',
  password: 'a-long-passphrase',
  authKey: 'a-second-long-key',
};

export const PORTAL = `/api/${process.env.ADMIN_PORTAL_PATH}/auth`;

/**
 * The login limiter allows ten attempts per ten minutes per client address, and its
 * store outlives every test in a file. A fresh address per sign-in keeps a suite from
 * being throttled by its own setup; the limiter has tests of its own.
 */
let signInCount = 0;
const nextIp = () => `10.9.${Math.floor(signInCount / 250)}.${(signInCount++ % 250) + 1}`;

/** Creates the one admin the site allows, and returns a signed-in session. */
export async function signIn(baseUrl, { ip = nextIp() } = {}) {
  await provisionAdmin({ ...CREDENTIALS, displayName: 'The Author' });

  const response = await request(baseUrl, 'POST', `${PORTAL}/login`, {
    body: CREDENTIALS,
    ip,
  });

  if (response.status !== 200) {
    throw new Error(`Test sign-in failed: ${response.status} ${response.text}`);
  }

  return { token: response.body.accessToken, cookies: response.cookies, response };
}

/** A minimal PDF — enough bytes for the upload path and the page-count heuristic. */
export function pdfBytes(pages = 2) {
  const objects = Array.from(
    { length: pages },
    (_, index) => `${index + 1} 0 obj\n<< /Type /Page >>\nendobj\n`,
  ).join('');
  return Buffer.from(`%PDF-1.7\n${objects}trailer\n%%EOF\n`, 'latin1');
}

/** multipart/form-data body, since the harness speaks fetch rather than a form library. */
export function multipart(fieldName, filename, contentType, bytes) {
  const boundary = `----maestro${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

  return {
    body: Buffer.concat([head, bytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
