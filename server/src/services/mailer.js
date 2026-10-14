import { env } from '../config/env.js';

/**
 * Sends plain-text mail as the author's alternate Gmail account, through the Gmail
 * API over HTTPS. No SDK: it is two requests — trade the refresh token for an access
 * token, then post the message — and `googleapis` would be a large install for that.
 *
 * Unconfigured, mail is printed to the server log, which is where a developer (or
 * the author, reading Render's logs) can still find a code.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

let transport = null;
let cachedToken = null;

/** Tests swap the transport for one that records what would have been sent. */
export function setMailTransport(fn) {
  transport = fn;
}

export const mailConfigured = () =>
  Boolean(env.gmail.clientId && env.gmail.clientSecret && env.gmail.refreshToken && env.gmail.sender);

export async function sendMail(message) {
  if (transport) return transport(message);

  if (!mailConfigured() || !message.to) {
    console.warn(
      `[mail] Gmail is not configured — would have sent to ${message.to || '(no recipient)'}:\n` +
        `  ${message.subject}\n  ${message.text.replace(/\n/g, '\n  ')}`,
    );
    return;
  }

  const response = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ raw: encode(message) }),
  });

  if (!response.ok) {
    // A revoked token should not stay cached and fail every send until a restart.
    if (response.status === 401) cachedToken = null;
    throw new Error(`Gmail send failed: ${response.status} ${await response.text()}`);
  }
}

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.gmail.clientId,
      client_secret: env.gmail.clientSecret,
      refresh_token: env.gmail.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Gmail token refresh failed: ${response.status} ${await response.text()}`);
  }

  const { access_token: value, expires_in: ttl } = await response.json();
  cachedToken = { value, expiresAt: Date.now() + ttl * 1000 };
  return value;
}

/** An RFC 2822 message, base64url-encoded the way the Gmail API wants it. */
function encode({ to, subject, text }) {
  const header = (value) => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
  const mime = [
    `From: the maestro <${env.gmail.sender}>`,
    `To: ${to}`,
    `Subject: ${header(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64'),
  ].join('\r\n');

  return Buffer.from(mime, 'utf8').toString('base64url');
}
