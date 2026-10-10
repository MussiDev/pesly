import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const folder = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/features/investments');

function sources(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) return sources(child);
    return /\.tsx?$/.test(entry) ? [child] : [];
  });
}

describe('no raw HTML from a broker file (DISC-001-07c, threat R-08)', () => {
  it('finds the investments sources to scan', () => {
    expect(sources(folder).length).toBeGreaterThan(10);
  });

  it('never inserts raw HTML in the investments feature', () => {
    const offenders = sources(folder).filter((file) =>
      /dangerouslySetInnerHTML|innerHTML\s*=|insertAdjacentHTML|document\.write/.test(
        readFileSync(file, 'utf8'),
      ),
    );

    expect(offenders).toEqual([]);
  });
});
