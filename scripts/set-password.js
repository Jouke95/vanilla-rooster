// Stelt het gedeelde wachtwoord in (of wijzigt het). Iedereen wordt daarbij uitgelogd.
// Gebruik: npm run set-password
require('dotenv').config();
const { initSchema } = require('../db');
const { setPassword } = require('../auth');

const MIN_LENGTH = 10;

// Wachtwoord vragen zonder het op het scherm te tonen
function askHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('Start dit commando in een terminal.'));
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let input = '';
    const onData = char => {
      if (char === '\r' || char === '\n' || char === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      } else if (char === '\u007f' || char === '\b') {
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

(async () => {
  const password = await askHidden('Nieuw wachtwoord: ');
  if (password.length < MIN_LENGTH) {
    console.error(`Het wachtwoord moet minstens ${MIN_LENGTH} tekens lang zijn.`);
    process.exit(1);
  }
  const again = await askHidden('Herhaal wachtwoord: ');
  if (password !== again) {
    console.error('De wachtwoorden zijn niet gelijk. Er is niets veranderd.');
    process.exit(1);
  }
  await initSchema();
  await setPassword(password);
  console.log('Wachtwoord ingesteld. Iedereen die ingelogd was, moet opnieuw inloggen.');
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
