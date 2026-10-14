import { existsSync } from 'node:fs';
import { connectDatabase, disconnectDatabase } from '../db/connect.js';
import { storeVideo } from '../services/letter-video.js';

/**
 * Puts the letter's film into the database, replacing what was there.
 *
 *   npm run letter:video -- <1080p.mp4> <720p.mp4>
 *
 * The files are rendered outside this repository and stay there; only the database
 * copy is served, and only to a reader holding the letter's token.
 */

const [hd, sd] = process.argv.slice(2);
if (!hd || !sd || !existsSync(hd) || !existsSync(sd)) {
  console.error('\nUsage: npm run letter:video -- <1080p.mp4> <720p.mp4>\n');
  process.exit(1);
}

try {
  const { mode } = await connectDatabase();
  if (mode === 'in-memory') {
    console.error('\n✗ No MONGODB_URI configured — this would write to a throwaway database.\n');
    process.exit(1);
  }
  for (const [quality, path] of [['hd', hd], ['sd', sd]]) {
    const result = await storeVideo(quality, path);
    console.log(`✓ ${quality}: stored (${result.replaced} older cop${result.replaced === 1 ? 'y' : 'ies'} removed)`);
  }
} finally {
  await disconnectDatabase();
}
