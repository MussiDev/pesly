// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_POINTER_KEY,
  clearSessionPointer,
  readSessionPointer,
  writeSessionPointer,
} from '../src/lib/local-store/session-pointer';

const ANA = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('session pointer', () => {
  it('round trips the user id and the verified flag, and clearing removes it (FR-01)', () => {
    expect(readSessionPointer()).toBeNull();

    writeSessionPointer({ userId: ANA, emailVerified: true });
    expect(readSessionPointer()).toEqual({ userId: ANA, emailVerified: true });

    clearSessionPointer();
    expect(readSessionPointer()).toBeNull();
    expect(localStorage.getItem(SESSION_POINTER_KEY)).toBeNull();
  });

  it('reads an invalid pointer (not JSON, wrong shape, bad id) as no pointer, not as an error (FR-01)', () => {
    for (const raw of [
      'not json',
      '{}',
      '{"userId":"../x","emailVerified":true}',
      '{"userId":"abc","emailVerified":"yes"}',
      '[]',
      'null',
    ]) {
      localStorage.setItem(SESSION_POINTER_KEY, raw);
      expect(readSessionPointer(), raw).toBeNull();
    }
  });

  it('treats a blocked localStorage as no pointer and writes nothing, without an error (FR-01)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(readSessionPointer()).toBeNull();
    expect(() => {
      writeSessionPointer({ userId: ANA, emailVerified: true });
    }).not.toThrow();
  });
});
