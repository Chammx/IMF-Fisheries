import { stdin, stdout } from 'node:process';
import { createPasswordHash } from '../src/admin-auth.js';

if (!stdin.isTTY) {
  throw new Error('Run this script in an interactive terminal so the password is not passed as an argument.');
}

function readHiddenPassword() {
  stdout.write('Admin password (12+ characters): ');
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let password = '';
    const cleanup = () => {
      stdin.off('data', handleData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const handleData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Password generation cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(password);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          password = Array.from(password).slice(0, -1).join('');
          continue;
        }
        if (character >= ' ') password += character;
      }
    };
    stdin.on('data', handleData);
  });
}

let password = await readHiddenPassword();
try {
  if (password.length < 12 || password.length > 256) {
    throw new Error('Admin password must be between 12 and 256 characters.');
  }
  console.log(createPasswordHash(password));
} finally {
  password = '';
}
