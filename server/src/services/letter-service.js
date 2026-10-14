import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { hashSecret, verifySecret } from '../config/hash.js';
import { Letter, LetterEvent, LetterGuard } from '../models/letter.js';
import { sendMail } from './mailer.js';
import { hasVideo } from './letter-video.js';

/**
 * The gate in front of the letter.
 *
 * One try per address per fifteen minutes. A wrong try is a strike. The reader can
 * then leave their Gmail, which is mailed to the author with a six-digit code; the
 * author decides whether to pass it on. The code lifts the wait but not the strike,
 * and three misses in a day close the gate to that address for a day regardless.
 *
 * Every step is logged as a LetterEvent for the author's Pulse page.
 */

const MINUTE = 60 * 1000;
export const COOLDOWN_MS = 15 * MINUTE;
export const BLOCK_MS = 24 * 60 * MINUTE;
const STRIKE_WINDOW_MS = 24 * 60 * MINUTE;
export const STRIKES_TO_BLOCK = 3;
export const OTP_TRIES = 3;
const TOKEN_TTL = '2h';
const TOKEN_AUDIENCE = 'the-maestro-letter';
/** Rides in the video's URL, so it opens the video and nothing else. */
const VIDEO_AUDIENCE = 'the-maestro-letter-video';

export const letterEnabled = () => Boolean(env.letter.pepper);

const hmac = (label, value) =>
  crypto.createHmac('sha256', env.letter.pepper).update(`${label}:${value}`).digest('hex');

// ── Answers ──────────────────────────────────────────────────────────────────

const squash = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/** A handle typed with or without its @, in any case, is the same handle. */
const handle = (value) => squash(value).replace(/^@+/, '').replace(/\s/g, '');

/**
 * The four answers as one canonical string, or null if any is missing or the date
 * is not a calendar date. The date arrives as a date input's `YYYY-MM-DD`.
 */
export function canonicalAnswers({ name, privateHandle, publicHandle, dob } = {}) {
  const parts = [squash(name), handle(privateHandle), handle(publicHandle), String(dob ?? '').trim()];
  if (parts.some((part) => !part)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[3])) return null;

  const date = new Date(`${parts[3]}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== parts[3]) return null;

  // Each part goes through the HMAC before scrypt, so the slow hash never sees
  // the answers themselves and the stored value is useless without the pepper.
  return hmac('answers', JSON.stringify(parts));
}

/** Used only by `npm run letter:set`. */
export async function setLetter({ answers, greetings }) {
  const canonical = canonicalAnswers(answers);
  if (!canonical) throw new Error('All four answers are required, and the date must be real.');

  await Letter.findOneAndUpdate(
    { singleton: 'letter' },
    { answerHash: await hashSecret(canonical), greetings },
    { upsert: true },
  );
}

// ── Guard ────────────────────────────────────────────────────────────────────

export const guardKey = (ip) => hmac('ip', ip || 'unknown');

/** Strikes that have aged out, or a block that has run its course, no longer count. */
function liveStrikes(guard, now) {
  if (!guard?.strikes) return 0;
  if (guard.blockedUntil && guard.blockedUntil <= now) return 0;
  if (guard.firstStrikeAt && guard.firstStrikeAt.getTime() + STRIKE_WINDOW_MS <= now.getTime()) {
    return 0;
  }
  return guard.strikes;
}

/**
 * What the reader at this address is allowed to do next:
 *   open      answer the four questions
 *   email     just missed — may leave a Gmail to have a code sent to the author
 *   otp       a code is out; enter it, or wait
 *   cooldown  nothing to do but wait
 *   blocked   closed for a day
 */
export function describe(guard, now = new Date()) {
  const strikes = liveStrikes(guard, now);
  const triesLeft = STRIKES_TO_BLOCK - strikes;

  if (guard?.blockedUntil && guard.blockedUntil > now) {
    return { state: 'blocked', retryAt: guard.blockedUntil };
  }
  if (guard?.cooldownUntil && guard.cooldownUntil > now) {
    if (guard.otpDigest && guard.otpTriesLeft > 0) {
      return { state: 'otp', retryAt: guard.cooldownUntil, triesLeft, otpTriesLeft: guard.otpTriesLeft };
    }
    if (strikes > 0 && !guard.otpRequested) {
      return { state: 'email', retryAt: guard.cooldownUntil, triesLeft };
    }
    return { state: 'cooldown', retryAt: guard.cooldownUntil, triesLeft };
  }
  return { state: 'open', triesLeft };
}

export async function status(ip) {
  if (!letterEnabled() || !(await Letter.exists({ singleton: 'letter' }))) return { state: 'off' };
  return describe(await LetterGuard.findOne({ key: guardKey(ip) }).lean());
}

const isOpen = (now) => ({
  $and: [
    { $or: [{ cooldownUntil: null }, { cooldownUntil: { $lte: now } }] },
    { $or: [{ blockedUntil: null }, { blockedUntil: { $lte: now } }] },
  ],
});

const log = (kind, { ip = '', email = '', strikes = 0 } = {}) =>
  LetterEvent.create({ kind, ip, email, strikes }).catch((error) =>
    // The gate must keep working even if the log cannot be written.
    console.error(`[letter] could not log ${kind}: ${error.message}`),
  );

/**
 * Checks the answers. The attempt is claimed atomically first — the cooldown is set
 * before the slow hash runs — so two requests fired together cannot both be judged.
 */
export async function unlock(ip, answers) {
  const letter = letterEnabled() ? await Letter.findOne({ singleton: 'letter' }).lean() : null;
  if (!letter) return { state: 'off' };

  const key = guardKey(ip);
  const now = new Date();
  const cooldownUntil = new Date(now.getTime() + COOLDOWN_MS);

  let claimed;
  try {
    claimed = await LetterGuard.findOneAndUpdate(
      { key, ...isOpen(now) },
      {
        $set: { ip, cooldownUntil, otpRequested: false, otpDigest: null, otpTriesLeft: 0 },
        $max: { expireAt: cooldownUntil },
      },
      { upsert: true, returnDocument: 'after', lean: true },
    );
  } catch (error) {
    // The upsert collided with this address's existing guard: it is waiting or blocked.
    if (error?.code !== 11000) throw error;
  }
  if (!claimed) return describe(await LetterGuard.findOne({ key }).lean(), now);

  const canonical = canonicalAnswers(answers);
  if (canonical && (await verifySecret(canonical, letter.answerHash))) {
    await LetterGuard.deleteOne({ key });
    await log('unlocked', { ip, email: claimed.email, strikes: liveStrikes(claimed, now) });
    return { state: 'unlocked', token: issueToken() };
  }

  return strike(claimed, now);
}

async function strike(guard, now) {
  const strikes = liveStrikes(guard, now) + 1;
  const firstStrikeAt = strikes === 1 ? now : guard.firstStrikeAt;

  if (strikes >= STRIKES_TO_BLOCK) {
    const blockedUntil = new Date(now.getTime() + BLOCK_MS);
    const updated = await LetterGuard.findOneAndUpdate(
      { key: guard.key },
      {
        $set: {
          strikes,
          firstStrikeAt,
          blockedUntil,
          cooldownUntil: null,
          otpRequested: false,
          otpDigest: null,
          otpTriesLeft: 0,
          expireAt: blockedUntil,
        },
      },
      { returnDocument: 'after', lean: true },
    );
    await log('blocked', { ip: guard.ip, email: guard.email, strikes });
    await notifyAuthor({
      subject: 'the maestro · the letter is blocked for a day',
      lines: [
        `Third wrong attempt at the letter. That network is blocked until ${when(blockedUntil)} IST.`,
        '',
        `IP: ${guard.ip || 'unknown'}`,
        ...(guard.email ? [`Gmail they gave earlier: ${guard.email}`] : []),
        '',
        'You can lift the block from Pulse.',
      ],
    });
    return describe(updated, now);
  }

  const expireAt = new Date(
    Math.max(guard.cooldownUntil.getTime(), firstStrikeAt.getTime() + STRIKE_WINDOW_MS),
  );
  const updated = await LetterGuard.findOneAndUpdate(
    { key: guard.key },
    { $set: { strikes, firstStrikeAt, blockedUntil: null, expireAt } },
    { returnDocument: 'after', lean: true },
  );
  await log('wrong', { ip: guard.ip, email: guard.email, strikes });
  return describe(updated, now);
}

// ── Bypass code ──────────────────────────────────────────────────────────────

const otpDigest = (key, code) => hmac('otp', `${key}:${code}`);

/** Lower-cased, trimmed, and plausibly an address — or null. */
export function cleanEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * The reader leaves their Gmail; the author gets it with a fresh code. Once per
 * strike, claimed atomically, so a reader cannot mail the author twice by asking twice.
 */
export async function requestOtp(ip, rawEmail) {
  if (!letterEnabled()) return { state: 'off' };

  const key = guardKey(ip);
  const now = new Date();
  const email = cleanEmail(rawEmail);
  if (!email) return { ...describe(await LetterGuard.findOne({ key }).lean(), now), error: 'email' };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const guard = await LetterGuard.findOneAndUpdate(
    {
      key,
      otpRequested: false,
      strikes: { $gt: 0 },
      cooldownUntil: { $gt: now },
      $or: [{ blockedUntil: null }, { blockedUntil: { $lte: now } }],
    },
    {
      $set: {
        otpRequested: true,
        email,
        otpDigest: otpDigest(key, code),
        otpTriesLeft: OTP_TRIES,
      },
    },
    { returnDocument: 'after', lean: true },
  );
  if (!guard) return describe(await LetterGuard.findOne({ key }).lean(), now);

  const strikes = liveStrikes(guard, now);
  await log('otp-requested', { ip: guard.ip, email, strikes });
  await notifyAuthor({
    subject: `the maestro · ${email} asked for a code`,
    lines: [
      `${email} got the letter's details wrong (${strikes} of ${STRIKES_TO_BLOCK}) and asked for a code.`,
      '',
      `Bypass code: ${code}`,
      '',
      `IP: ${guard.ip || 'unknown'}`,
      `Valid until ${when(guard.cooldownUntil)} IST, for ${OTP_TRIES} tries.`,
      '',
      'Share it only if you want them to have another go now.',
      'It lifts the wait, not the strike.',
    ],
  });
  return describe(guard, now);
}

export async function redeemOtp(ip, rawCode) {
  if (!letterEnabled()) return { state: 'off' };

  const key = guardKey(ip);
  const now = new Date();

  // Spend a try before comparing, so parallel guesses cannot share one.
  const guard = await LetterGuard.findOneAndUpdate(
    { key, otpDigest: { $ne: null }, otpTriesLeft: { $gt: 0 }, cooldownUntil: { $gt: now } },
    { $inc: { otpTriesLeft: -1 } },
    { returnDocument: 'after', lean: true },
  );
  if (!guard) return describe(await LetterGuard.findOne({ key }).lean(), now);

  const code = String(rawCode ?? '').replace(/\D/g, '');
  const expected = Buffer.from(guard.otpDigest, 'hex');
  const given = Buffer.from(otpDigest(key, code), 'hex');
  const who = { ip: guard.ip, email: guard.email, strikes: liveStrikes(guard, now) };

  if (code.length === 6 && crypto.timingSafeEqual(expected, given)) {
    const updated = await LetterGuard.findOneAndUpdate(
      { key },
      { $set: { cooldownUntil: null, otpDigest: null, otpTriesLeft: 0 } },
      { returnDocument: 'after', lean: true },
    );
    await log('otp-accepted', who);
    return describe(updated, now);
  }

  await log('otp-wrong', who);
  if (guard.otpTriesLeft > 0) return describe(guard, now);

  // Out of tries: the code is spent and the wait simply runs out.
  const spent = await LetterGuard.findOneAndUpdate(
    { key },
    { $set: { otpDigest: null } },
    { returnDocument: 'after', lean: true },
  );
  return describe(spent, now);
}

// ── The author's view ────────────────────────────────────────────────────────

const EVENT_LIMIT = 100;

/** For Pulse: what happened lately, and which addresses are held right now. */
export async function overview(now = new Date()) {
  const [events, guards, opened] = await Promise.all([
    LetterEvent.find().sort({ at: -1 }).limit(EVENT_LIMIT).lean(),
    LetterGuard.find().sort({ expireAt: -1 }).lean(),
    LetterEvent.countDocuments({ kind: 'unlocked' }),
  ]);

  const held = guards
    .map((guard) => ({ guard, view: describe(guard, now) }))
    .filter(({ guard, view }) => view.state !== 'open' || liveStrikes(guard, now) > 0);

  return {
    enabled: letterEnabled() && Boolean(await Letter.exists({ singleton: 'letter' })),
    opened,
    events: events.map((event) => ({
      id: String(event._id),
      kind: event.kind,
      ip: event.ip,
      email: event.email,
      strikes: event.strikes,
      at: event.at,
    })),
    held: held.map(({ guard, view }) => ({
      id: String(guard._id),
      ip: guard.ip,
      email: guard.email,
      strikes: liveStrikes(guard, now),
      state: view.state,
      retryAt: view.retryAt ?? null,
    })),
  };
}

/** Clears an address completely: no wait, no strikes, no block. */
export async function release(id) {
  const guard = await LetterGuard.findOneAndDelete({ _id: id }).lean();
  if (!guard) return false;
  await log('unblocked', { ip: guard.ip, email: guard.email, strikes: 0 });
  return true;
}

// ── After the gate ───────────────────────────────────────────────────────────

const tokenSecret = () => hmac('token', 'letter');

function issueToken() {
  return jwt.sign({ sub: 'letter' }, tokenSecret(), {
    expiresIn: TOKEN_TTL,
    audience: TOKEN_AUDIENCE,
    issuer: 'the-maestro',
  });
}

export function verifyToken(token) {
  if (!letterEnabled() || !token) return false;
  try {
    jwt.verify(token, tokenSecret(), { audience: TOKEN_AUDIENCE, issuer: 'the-maestro' });
    return true;
  } catch {
    return false;
  }
}

/**
 * A <video> cannot send headers, so the video gets a token of its own to carry in its
 * URL — one that would open nothing else if it leaked into a log.
 */
function issueVideoToken() {
  return jwt.sign({ sub: 'letter-video' }, tokenSecret(), {
    expiresIn: TOKEN_TTL,
    audience: VIDEO_AUDIENCE,
    issuer: 'the-maestro',
  });
}

export function verifyVideoToken(token) {
  if (!letterEnabled() || !token || typeof token !== 'string') return false;
  try {
    jwt.verify(token, tokenSecret(), { audience: VIDEO_AUDIENCE, issuer: 'the-maestro' });
    return true;
  } catch {
    return false;
  }
}

export async function content() {
  const [letter, video] = await Promise.all([
    Letter.findOne({ singleton: 'letter' }).select('greetings').lean(),
    hasVideo(),
  ]);
  return {
    greetings: letter?.greetings ?? [],
    video: video ? { token: issueVideoToken() } : null,
  };
}

// ── Mail ─────────────────────────────────────────────────────────────────────

const when = (date) =>
  date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

async function notifyAuthor({ subject, lines }) {
  try {
    await sendMail({ to: env.letter.notifyTo, subject, text: lines.join('\n') });
  } catch (error) {
    // The reader still sees the code screen; the author can find the code in the log.
    console.error(`[letter] could not mail the author (${error.message}):\n${lines.join('\n')}`);
  }
}
