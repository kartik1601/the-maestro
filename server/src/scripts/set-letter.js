import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../db/connect.js';
import { env } from '../config/env.js';
import { setLetter } from '../services/letter-service.js';

/**
 * Sets the four answers that open the letter on the Blogs page, and the names its
 * opening animation steps through.
 *
 * Nothing about her is in the repository: this script asks (visibly, with a review
 * before saving), hashes the answers with
 * the server's LETTER_PEPPER, and stores only the hash. The names are stored as typed,
 * because the page has to show them — they never reach a reader without the answers.
 *
 *   npm run letter:set
 *
 * Run it against the same LETTER_PEPPER the deployed API uses, or the stored hash will
 * never match there.
 */

const rl = readline.createInterface({ input: stdin, output: stdout });

try {
  if (!env.letter.pepper) {
    console.error('\n✗ LETTER_PEPPER is not set. Add it to server/.env first — see .claude/API_KEYS.md.\n');
    process.exit(1);
  }

  const { mode } = await connectDatabase();
  if (mode === 'in-memory') {
    console.error('\n✗ No MONGODB_URI configured — this would write to a throwaway database.\n');
    process.exit(1);
  }

  console.log('\nAnswers are matched ignoring case, extra spaces and a leading @.');
  console.log('What you type is shown so it can be checked; clear the terminal afterwards.\n');

  // Visible on purpose: a typo here locks her out, and hidden input cannot be checked.
  const ask = async (prompt) => (await rl.question(prompt)).trim();

  const answers = {
    name: await ask('Full name: '),
    privateHandle: await ask('Private Instagram username: '),
    publicHandle: await ask('Public Instagram username: '),
    dob: await ask('Date of birth (YYYY-MM-DD): '),
  };

  const greetings = (await ask('Greeting names, in order, comma-separated: '))
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (greetings.length === 0) {
    console.error('\n✗ At least one greeting name is needed.\n');
    process.exit(1);
  }

  console.log('\nAbout to save:');
  console.log(`  Full name        ${answers.name}`);
  console.log(`  Private username ${answers.privateHandle}`);
  console.log(`  Public username  ${answers.publicHandle}`);
  console.log(`  Date of birth    ${answers.dob}`);
  console.log(`  Greetings        ${greetings.join('  →  ')}\n`);

  const confirm = await rl.question('Save these? (y/N) ');
  if (!/^y(es)?$/i.test(confirm.trim())) {
    console.log('Cancelled. Nothing was saved.');
    process.exit(0);
  }

  await setLetter({ answers, greetings });
  console.log(`\n✓ Letter set: answers stored as one peppered scrypt hash, ${greetings.length} greetings.\n`);
} catch (error) {
  console.error(`\n✗ ${error.message}\n`);
  process.exitCode = 1;
} finally {
  rl.close();
  await disconnectDatabase();
  await mongoose.disconnect();
}
