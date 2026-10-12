import { createECDH } from 'node:crypto';
import { importJWK, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { createVapidAuthorization } from '../../src/push/infrastructure/providers/vapid';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const privateKey = ecdh.getPrivateKey().toString('base64url');
const publicKey = ecdh.getPublicKey().toString('base64url');
const SUBJECT = 'mailto:push@pesly.com.ar';
const URL_A = 'https://fcm.googleapis.com/fcm/send/abc';
const URL_B = 'https://updates.push.services.mozilla.com/wpush/v2/abc';

async function parse(header: string) {
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  expect(match).not.toBeNull();
  const token = match?.[1] as string;
  const k = match?.[2] as string;
  const bytes = Buffer.from(publicKey, 'base64url');
  const key = await importJWK(
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytes.subarray(1, 33).toString('base64url'),
      y: bytes.subarray(33, 65).toString('base64url'),
    },
    'ES256',
  );
  const { payload } = await jwtVerify(token, key, { algorithms: ['ES256'] });
  return { payload, k };
}

describe('createVapidAuthorization', () => {
  it('builds a token jwtVerify accepts with aud, sub and a short exp', async () => {
    const header = await createVapidAuthorization({
      pushUrl: URL_A,
      subject: SUBJECT,
      publicKey,
      privateKey,
    });
    const { payload, k } = await parse(header);
    expect(k).toBe(publicKey);
    expect(payload.aud).toBe('https://fcm.googleapis.com');
    expect(payload.sub).toBe(SUBJECT);
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(12 * 3600);
    expect(payload.exp as number).toBeGreaterThan(payload.iat as number);
  });

  it('uses the origin of each push URL as aud', async () => {
    const header = await createVapidAuthorization({
      pushUrl: URL_B,
      subject: SUBJECT,
      publicKey,
      privateKey,
    });
    const { payload } = await parse(header);
    expect(payload.aud).toBe('https://updates.push.services.mozilla.com');
  });

  it('fails on a malformed private key', async () => {
    await expect(
      createVapidAuthorization({ pushUrl: URL_A, subject: SUBJECT, publicKey, privateKey: 'AAAA' }),
    ).rejects.toThrow();
  });
});
