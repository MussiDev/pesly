import { describe, expect, it } from 'vitest';
import {
  BALANZ_UNCOMPRESSED_MAX_BYTES,
  assertZipWithinLimits,
} from '@/features/investments/balanz-import/zip-limits';
import { BalanzParseError } from '@/features/investments/balanz-import/balanz-types';

/** A zip with only the structures the limit reads: one local header stub, the directory, the end. */
function zipDeclaring(sizes: number[]): ArrayBuffer {
  const name = 'x';
  const entry = 46 + name.length;
  const local = 4;
  const bytes = new Uint8Array(local + entry * sizes.length + 22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  sizes.forEach((size, index) => {
    const at = local + entry * index;
    view.setUint32(at, 0x02014b50, true);
    view.setUint32(at + 24, size, true);
    view.setUint16(at + 28, name.length, true);
    bytes[at + 46] = 0x78;
  });
  const end = local + entry * sizes.length;
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end + 10, sizes.length, true);
  view.setUint32(end + 12, entry * sizes.length, true);
  view.setUint32(end + 16, local, true);
  return bytes.buffer;
}

function reason(buffer: ArrayBuffer): string | null {
  try {
    assertZipWithinLimits(buffer);
    return null;
  } catch (error) {
    if (error instanceof BalanzParseError) return error.reason;
    throw error;
  }
}

const bytesOf = (text: string) => new TextEncoder().encode(text).buffer;

describe('assertZipWithinLimits (DISC-001-07c NFR-03)', () => {
  it('accepts a zip that declares 10 MB or less uncompressed in total', () => {
    expect(BALANZ_UNCOMPRESSED_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(reason(zipDeclaring([1024, 4096]))).toBeNull();
    expect(reason(zipDeclaring([BALANZ_UNCOMPRESSED_MAX_BYTES]))).toBeNull();
  });

  it('rejects a zip that declares 11 MB uncompressed before any parsing (AC-08)', () => {
    expect(reason(zipDeclaring([11 * 1024 * 1024]))).toBe('tooLarge');
  });

  it('adds up the entries, so many small ones cannot slip under the limit (AC-08)', () => {
    expect(reason(zipDeclaring([6 * 1024 * 1024, 5 * 1024 * 1024]))).toBe('tooLarge');
  });

  it('rejects a zip64 size marker, which a small spreadsheet never needs (AC-08)', () => {
    expect(reason(zipDeclaring([0xffffffff]))).toBe('tooLarge');
  });

  it.each([
    ['a CSV', bytesOf('ticker,precio\nIBIT,7535\n')],
    ['a PDF', bytesOf('%PDF-1.7\n1 0 obj\n')],
    ['an empty file', new ArrayBuffer(0)],
    ['a few bytes', new ArrayBuffer(10)],
    ['a zip with a cut directory', zipDeclaring([5]).slice(0, 40)],
  ])('rejects %s as not an Excel file (AC-07)', (_label, buffer) => {
    expect(reason(buffer)).toBe('notExcel');
  });

  it('rejects a directory entry that points outside the file', () => {
    const buffer = zipDeclaring([5]);
    new DataView(buffer).setUint32(buffer.byteLength - 22 + 16, 9999, true);

    expect(reason(buffer)).toBe('notExcel');
  });
});
