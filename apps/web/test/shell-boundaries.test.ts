import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const features = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/features');

function sources(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) return sources(child);
    return /\.tsx?$/.test(entry) ? [child] : [];
  });
}

function importLines(dir: string): string[] {
  return sources(dir).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => /\bfrom\s+['"]/.test(line))
      .map((line) => `${file}: ${line.trim()}`),
  );
}

describe('features/shell module boundaries', () => {
  it('has sources to scan', () => {
    expect(sources(join(features, 'shell')).length).toBeGreaterThan(5);
  });

  it('features/shell imports nothing from features/auth', () => {
    const offenders = importLines(join(features, 'shell')).filter((line) =>
      /features\/auth|\.\.\/auth|\.\.\/\.\.\/auth/.test(line),
    );
    expect(offenders).toEqual([]);
  });

  it('features/auth imports nothing from features/shell', () => {
    const offenders = importLines(join(features, 'auth')).filter((line) =>
      /features\/shell|\/shell\//.test(line),
    );
    expect(offenders).toEqual([]);
  });
});
