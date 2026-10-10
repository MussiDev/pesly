import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const trees = [
  'apps/api/src/recurring',
  'packages/shared/src/recurring',
  'apps/web/src/features/recurring',
];
const jobFiles = [
  'apps/api/src/recurring/application/record-due-occurrences.ts',
  'apps/api/src/recurring/application/ports/automatic-payment-source.ts',
  'apps/api/src/recurring/infrastructure/db/drizzle-automatic-payment-source.ts',
  'apps/api/src/recurring/infrastructure/jobs/recording-job.ts',
  'apps/api/src/recurring/jobs.ts',
];
const forbidden = ['Number(', 'parseFloat', 'toFixed', 'Math.round'];

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

function offendersIn(directory: string): string[] {
  return sources(directory).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return forbidden.filter((token) => text.includes(token)).map((t) => `${file}: ${t}`);
  });
}

describe('no floating-point money arithmetic (NFR-01)', () => {
  it.each(trees)('%s contains sources and no float conversions or rounding', (tree) => {
    expect(sources(join(root, tree)).length).toBeGreaterThan(0);
    expect(offendersIn(join(root, tree))).toEqual([]);
  });

  it.each(jobFiles)('%s is part of the scan and has no float conversions', (file) => {
    const scanned = sources(join(root, 'apps/api/src/recurring'));
    expect(scanned).toContain(join(root, file));
    expect(
      offendersIn(join(root, 'apps/api/src/recurring')).filter((o) =>
        o.includes(file.split('/').pop() ?? ''),
      ),
    ).toEqual([]);
  });

  it('fails when a float is introduced in a job file', () => {
    const probeRoot = mkdtempSync(join(tmpdir(), 'no-float-job-'));
    try {
      mkdirSync(join(probeRoot, 'infrastructure', 'jobs'), { recursive: true });
      const file = join(probeRoot, 'infrastructure', 'jobs', 'recording-job.ts');
      writeFileSync(file, 'export const total = parseFloat("1.5") + Math.round(2.4);');
      expect(offendersIn(probeRoot)).toEqual([`${file}: parseFloat`, `${file}: Math.round`]);
    } finally {
      rmSync(probeRoot, { recursive: true, force: true });
    }
  });

  // Proof that the scan can fail.
  it('flags a probe file with toFixed and ignores a clean one', () => {
    const probeRoot = mkdtempSync(join(tmpdir(), 'no-float-probe-'));
    try {
      mkdirSync(join(probeRoot, 'nested'), { recursive: true });
      const file = join(probeRoot, 'nested', 'probe.ts');
      writeFileSync(file, 'export const amount = (1.5).toFixed(2);');
      writeFileSync(join(probeRoot, 'clean.ts'), 'export const amount = 150n;');
      expect(offendersIn(probeRoot)).toEqual([`${file}: toFixed`]);
    } finally {
      rmSync(probeRoot, { recursive: true, force: true });
    }
  });
});
