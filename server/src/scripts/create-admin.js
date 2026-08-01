import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../db/connect.js';
import { provisionAdmin } from '../services/auth-service.js';
import { Admin } from '../models/admin.js';

/**
 * Provisions (or replaces) the single admin. This is the only supported way to set
 * production credentials — the three factors are hashed here and the plaintext is
 * never written to disk, an env file, or the database.
 *
 *   npm run admin:create
 */

const rl = readline.createInterface({ input: stdin, output: stdout });

/** Suppresses terminal echo so secrets do not linger on screen or in scrollback. */
async function askSecret(prompt) {
  const wasRaw = stdin.isRaw;
  stdout.write(prompt);

  const onData = (char) => {
    // Re-render the prompt without the typed characters.
    if (!/[\r\n]/.test(char.toString())) {
      stdout.clearLine(0);
      stdout.cursorTo(0);
      stdout.write(prompt);
    }
  };

  stdin.on('data', onData);
  try {
    const answer = await rl.question('');
    return answer.trim();
  } finally {
    stdin.off('data', onData);
    if (wasRaw !== undefined) stdin.isRaw = wasRaw;
    stdout.write('\n');
  }
}

try {
  const { mode } = await connectDatabase();
  if (mode === 'in-memory') {
    console.error('\n✗ No MONGODB_URI configured — this would write to a throwaway database.');
    console.error('  Set MONGODB_URI in server/.env first. See .claude/API_KEYS.md.\n');
    process.exit(1);
  }

  const alreadyExists = await Admin.exists({ singleton: 'admin' });
  if (alreadyExists) {
    const confirm = await rl.question(
      'An admin already exists. Replace it? All active sessions end. (y/N) ',
    );
    if (!/^y(es)?$/i.test(confirm.trim())) {
      console.log('Cancelled.');
      process.exit(0);
    }
  }

  const displayName = (await rl.question('Display name [The Author]: ')).trim() || 'The Author';
  const username = await askSecret('Username: ');
  const password = await askSecret('Password: ');
  const authKey = await askSecret('Auth key: ');
  const confirmKey = await askSecret('Confirm auth key: ');

  if (!username || !password || !authKey) {
    console.error('\n✗ All three factors are required.\n');
    process.exit(1);
  }
  if (authKey !== confirmKey) {
    console.error('\n✗ Auth keys did not match.\n');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('\n✗ Use a password of at least 12 characters.\n');
    process.exit(1);
  }

  await provisionAdmin({ username, password, authKey, displayName });

  console.log('\n✓ Admin provisioned. All three factors are stored as scrypt hashes.');
  console.log('  Keep the auth key somewhere the password manager is not.\n');
} finally {
  rl.close();
  await disconnectDatabase();
  await mongoose.disconnect();
}
