import { createECDH, createDecipheriv, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptPayload } from '../../src/push/infrastructure/providers/aes128gcm';
import { RFC8291, b64 } from './rfc8291-vector';

const serverKeyPair = { privateKey: b64(RFC8291.asPrivate), publicKey: b64(RFC8291.asPublic) };
const plaintext = new TextEncoder().encode(RFC8291.plaintext);

function decrypt(body: Uint8Array): string {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const idlen = buf[20] as number;
  const asPublic = buf.subarray(21, 21 + idlen);
  const record = buf.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(RFC8291.uaPrivate, 'base64url'));
  const secret = ecdh.computeSecret(asPublic);
  const uaPublic = Buffer.from(RFC8291.uaPublic, 'base64url');
  const prk = Buffer.from(
    hkdfSync(
      'sha256',
      secret,
      Buffer.from(RFC8291.authSecret, 'base64url'),
      Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]),
      32,
    ),
  );
  const cek = Buffer.from(
    hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ]);
  const end = padded.lastIndexOf(0x02);
  return padded.subarray(0, end).toString('utf8');
}

describe('encryptPayload (RFC 8291)', () => {
  it('reproduces the RFC 8291 example body byte for byte', () => {
    const body = encryptPayload({
      plaintext,
      uaPublic: b64(RFC8291.uaPublic),
      authSecret: b64(RFC8291.authSecret),
      salt: b64(RFC8291.salt),
      serverKeyPair,
    });
    expect(Buffer.from(body).toString('base64url')).toBe(RFC8291.body);
  });

  it('is decryptable by the user agent private key', () => {
    const body = encryptPayload({
      plaintext,
      uaPublic: b64(RFC8291.uaPublic),
      authSecret: b64(RFC8291.authSecret),
      salt: b64(RFC8291.salt),
      serverKeyPair,
    });
    expect(decrypt(body)).toBe(RFC8291.plaintext);
  });

  it('uses a random salt and key pair when none are given', () => {
    const input = {
      plaintext,
      uaPublic: b64(RFC8291.uaPublic),
      authSecret: b64(RFC8291.authSecret),
    };
    const a = encryptPayload(input);
    const b = encryptPayload(input);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(decrypt(a)).toBe(RFC8291.plaintext);
  });

  it('rejects a user agent key that is not 65 bytes or an auth secret that is not 16', () => {
    const base = {
      plaintext,
      uaPublic: b64(RFC8291.uaPublic),
      authSecret: b64(RFC8291.authSecret),
    };
    expect(() => encryptPayload({ ...base, uaPublic: new Uint8Array(64) })).toThrow();
    expect(() => encryptPayload({ ...base, authSecret: new Uint8Array(15) })).toThrow();
  });

  it('rejects a point that is not on the curve', () => {
    const bad = new Uint8Array(65).fill(1);
    bad[0] = 4;
    expect(() =>
      encryptPayload({ plaintext, uaPublic: bad, authSecret: b64(RFC8291.authSecret) }),
    ).toThrow();
  });

  it('rejects a body over the single-record limit of 3993 bytes', () => {
    const base = { uaPublic: b64(RFC8291.uaPublic), authSecret: b64(RFC8291.authSecret) };
    expect(() => encryptPayload({ ...base, plaintext: new Uint8Array(3993) })).not.toThrow();
    expect(() => encryptPayload({ ...base, plaintext: new Uint8Array(3994) })).toThrow();
  });
});
