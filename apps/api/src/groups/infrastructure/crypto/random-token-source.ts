import { createHash, randomBytes } from 'node:crypto';
import type { IssuedToken, TokenSource } from '../../application/ports/token-source';

const TOKEN_BYTES = 32;

/** 256 bits from the OS CSPRNG, base64url (43 characters); only the SHA-256 hex is stored. */
export class RandomTokenSource implements TokenSource {
  generate(): IssuedToken {
    const raw = randomBytes(TOKEN_BYTES).toString('base64url');
    return { raw, hash: this.hash(raw) };
  }

  hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
