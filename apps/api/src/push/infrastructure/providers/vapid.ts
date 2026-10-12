import { SignJWT, importJWK } from 'jose';

const TOKEN_LIFETIME_SECONDS = 12 * 3600 - 60;

export interface VapidConfig {
  /** 65-byte uncompressed P-256 point, base64url. */
  publicKey: string;
  /** 32-byte raw scalar, base64url. */
  privateKey: string;
  subject: string;
}

/** Builds the RFC 8292 `Authorization` header value for one push service. */
export async function createVapidAuthorization(
  input: VapidConfig & { pushUrl: string; now?: Date },
): Promise<string> {
  const point = Buffer.from(input.publicKey, 'base64url');
  const scalar = Buffer.from(input.privateKey, 'base64url');
  if (point.length !== 65 || point[0] !== 0x04 || scalar.length !== 32) {
    throw new Error('invalid VAPID key');
  }
  const key = await importJWK(
    {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33, 65).toString('base64url'),
      d: scalar.toString('base64url'),
    },
    'ES256',
  );
  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setAudience(new URL(input.pushUrl).origin)
    .setSubject(input.subject)
    .setIssuedAt(iat)
    .setExpirationTime(iat + TOKEN_LIFETIME_SECONDS)
    .sign(key);
  return `vapid t=${token}, k=${input.publicKey}`;
}
