import { createHash } from 'node:crypto';
import { lineKey, lineKeys, type ImportedLineIdentity } from '../domain/statement-import';

const digest = (key: string): string => createHash('sha256').update(key).digest('hex');

/** The stored fingerprint of one line: SHA-256 of its key, so no line data is kept. */
export function fingerprintLine(line: ImportedLineIdentity, occurrence: number): string {
  return digest(lineKey(line, occurrence));
}

/** Fingerprints of the lines of one file, in order; identical lines never collapse. */
export function fingerprintLines(lines: readonly ImportedLineIdentity[]): string[] {
  return lineKeys(lines).map(digest);
}
