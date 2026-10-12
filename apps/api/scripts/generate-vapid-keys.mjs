// Prints a VAPID key pair for one environment. Run it by hand and paste the values into that
// environment's settings; nothing imports this file and it never writes to disk.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });

// The uncompressed point: 0x04 followed by the 32 byte X and Y coordinates.
const publicPoint = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(jwk.x, 'base64url'),
  Buffer.from(jwk.y, 'base64url'),
]);

process.stdout.write(`VAPID_PUBLIC_KEY=${publicPoint.toString('base64url')}\n`);
process.stdout.write(`VAPID_PRIVATE_KEY=${jwk.d}\n`);
