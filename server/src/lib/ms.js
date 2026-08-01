const UNITS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Parses the same duration strings jsonwebtoken accepts ('15m', '7d', '900') into
 * milliseconds, so the cookie lifetime and the token lifetime cannot drift apart.
 */
export default function ms(value) {
  if (typeof value === 'number') return value;

  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?$/i.exec(String(value).trim());
  if (!match) throw new Error(`Unrecognized duration: ${value}`);

  const [, amount, unit] = match;
  // Bare numbers are seconds, matching jsonwebtoken's convention.
  return Number(amount) * (unit ? UNITS[unit.toLowerCase()] : UNITS.s);
}
