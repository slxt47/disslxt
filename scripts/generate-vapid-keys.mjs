// Prints a fresh VAPID key pair for Web Push as .env lines:
//   pnpm vapid:generate >> .env
// Keep the private key secret. Changing the keys invalidates every existing subscription
// (browsers re-subscribe the next time the user enables notifications).
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const webpush = createRequire(resolve('backend/package.json'))('web-push');
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
