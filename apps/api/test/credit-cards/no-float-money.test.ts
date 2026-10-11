import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** NFR-01: the automatic debit amount is a bigint remainder end to end, never a float. */
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

// The files DISC-001-10e adds; the files it only modifies already carried their own guards.
const debitFiles = [
  'apps/api/src/credit-cards/domain/automatic-debit.ts',
  'apps/api/src/credit-cards/application/record-automatic-debits.ts',
  'apps/api/src/credit-cards/application/set-card-debit-accounts.ts',
  'apps/api/src/credit-cards/application/ports/automatic-debit-source.ts',
  'apps/api/src/credit-cards/application/ports/automatic-debit-recorder.ts',
  'apps/api/src/credit-cards/application/ports/automatic-debit-log.ts',
  'apps/api/src/credit-cards/application/ports/debit-accounts.ts',
  'apps/api/src/credit-cards/infrastructure/db/drizzle-automatic-debit-source.ts',
  'apps/api/src/credit-cards/infrastructure/db/drizzle-automatic-debit-log.ts',
  'apps/api/src/credit-cards/infrastructure/db/drizzle-debit-accounts.ts',
  'apps/api/src/credit-cards/infrastructure/jobs/automatic-debit-job.ts',
  'apps/api/src/credit-cards/jobs.ts',
  'apps/web/src/features/credit-cards/components/debit-accounts-form.tsx',
  'apps/web/src/features/credit-cards/debit-accounts-request.ts',
];
const forbidden = ['Number(', 'parseFloat', 'toFixed', 'Math.round'];

function offendersIn(files: readonly string[]): string[] {
  return files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return forbidden.filter((token) => text.includes(token)).map((token) => `${file}: ${token}`);
  });
}

describe('no floating-point money in the automatic debit files (NFR-01)', () => {
  it.each(debitFiles)('%s exists and has no float conversion or rounding', (file) => {
    const path = join(root, file);
    expect(existsSync(path)).toBe(true);
    expect(offendersIn([path])).toEqual([]);
  });

  // Proof that the scan can fail: a planted token is reported with its file and token.
  it('reports the file and the token of a planted float and ignores a clean file (sad path)', () => {
    const probeRoot = mkdtempSync(join(tmpdir(), 'no-float-debit-'));
    try {
      const planted = join(probeRoot, 'infrastructure', 'jobs', 'automatic-debit-job.ts');
      mkdirSync(dirname(planted), { recursive: true });
      writeFileSync(planted, 'export const share = parseFloat("1.5") + Math.round(2.4);');
      const clean = join(probeRoot, 'clean.ts');
      writeFileSync(clean, 'export const remainder = 4_000_000n;');
      expect(offendersIn([planted, clean])).toEqual([
        `${planted}: parseFloat`,
        `${planted}: Math.round`,
      ]);
    } finally {
      rmSync(probeRoot, { recursive: true, force: true });
    }
  });
});
