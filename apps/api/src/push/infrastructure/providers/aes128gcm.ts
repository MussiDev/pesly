import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

const RECORD_SIZE = 4096;
const HEADER_FIXED = 16 + 4 + 1;
const PUBLIC_KEY_BYTES = 65;
const AUTH_BYTES = 16;
const SALT_BYTES = 16;
const TAG_BYTES = 16;
/** Plaintext limit of a single record: 4096 - (21 + 65 header) - 16 tag - 1 delimiter. */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - HEADER_FIXED - PUBLIC_KEY_BYTES - TAG_BYTES - 1;

export interface EncryptPayloadInput {
  plaintext: Uint8Array;
  /** The browser's 65-byte uncompressed P-256 point. */
  uaPublic: Uint8Array;
  /** The browser's 16-byte auth secret. */
  authSecret: Uint8Array;
  /** Random when omitted; fixed only to reproduce the RFC 8291 example. */
  salt?: Uint8Array;
  /** Ephemeral key pair, generated when omitted; fixed only to reproduce the RFC 8291 example. */
  serverKeyPair?: { privateKey: Uint8Array; publicKey: Uint8Array };
}

export function decodeBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

/** Encrypts one Web Push message (RFC 8291, aes128gcm of RFC 8188); throws on invalid input. */
export function encryptPayload(input: EncryptPayloadInput): Uint8Array {
  const { plaintext, uaPublic, authSecret } = input;
  if (uaPublic.length !== PUBLIC_KEY_BYTES || uaPublic[0] !== 0x04) {
    throw new Error('invalid user agent public key');
  }
  if (authSecret.length !== AUTH_BYTES) throw new Error('invalid auth secret');
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('payload too large');
  const salt = input.salt ?? randomBytes(SALT_BYTES);
  if (salt.length !== SALT_BYTES) throw new Error('invalid salt');

  const ecdh = createECDH('prime256v1');
  if (input.serverKeyPair) {
    ecdh.setPrivateKey(Buffer.from(input.serverKeyPair.privateKey));
  } else {
    ecdh.generateKeys();
  }
  const asPublic = input.serverKeyPair
    ? Buffer.from(input.serverKeyPair.publicKey)
    : ecdh.getPublicKey();
  if (asPublic.length !== PUBLIC_KEY_BYTES) throw new Error('invalid server public key');
  const secret = ecdh.computeSecret(Buffer.from(uaPublic));

  const derive = (
    ikm: Uint8Array,
    saltBytes: Uint8Array,
    info: Uint8Array,
    length: number,
  ): Buffer => Buffer.from(hkdfSync('sha256', ikm, saltBytes, info, length));
  const prk = derive(
    secret,
    authSecret,
    Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]),
    32,
  );
  const cek = derive(prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = derive(prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(HEADER_FIXED);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, SALT_BYTES);
  header[SALT_BYTES + 4] = PUBLIC_KEY_BYTES;
  return new Uint8Array(Buffer.concat([header, asPublic, encrypted]));
}
