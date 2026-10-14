import { stdin, stdout } from 'node:process';

/**
 * Asks through `rl` without leaving the answer on screen, so secrets do not linger
 * in scrollback. Shared by the one-off provisioning scripts.
 */
export async function askSecret(rl, prompt) {
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
