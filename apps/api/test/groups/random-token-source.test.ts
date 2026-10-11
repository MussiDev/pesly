import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RandomTokenSource } from '../../src/groups/infrastructure/crypto/random-token-source';

describe('RandomTokenSource', () => {
  const source = new RandomTokenSource();

  it('returns 43-character base64url tokens and 1,000 draws are distinct', () => {
    const raws = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const { raw } = source.generate();
      expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
      raws.add(raw);
    }
    expect(raws.size).toBe(1000);
  });

  it('hashes a token as SHA-256 hex, the same way for generate and hash', () => {
    const { raw, hash } = source.generate();

    expect(hash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(source.hash(raw)).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never stores the raw value in the hash (sad path)', () => {
    const { raw, hash } = source.generate();

    expect(hash).not.toContain(raw);
    expect(source.hash(`${raw}x`)).not.toBe(hash);
  });
});
