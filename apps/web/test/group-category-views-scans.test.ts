import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const groups = join(root, 'apps/web/src/features/groups');

// The folders the group category views add or change in the web app.
const FOLDERS = [
  join(groups, 'category-views'),
  join(groups, 'expenses/list'),
  join(groups, 'expenses/edit'),
];

function sources(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) return sources(child);
    return /\.tsx?$/.test(entry) ? [child] : [];
  });
}

const files = FOLDERS.flatMap((folder) => sources(folder));
const label = (file: string) => relative(root, file).replaceAll('\\', '/');

// The one function that turns a basis-point count (never money) into a number: spec decision D6.
const BASIS_POINT_FILE = 'apps/web/src/features/groups/category-views/format.ts';

describe('the group category view sources', () => {
  it('finds the sources to scan', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(sources(join(groups, 'category-views')).length).toBeGreaterThanOrEqual(8);
  });

  it('never injects raw HTML', () => {
    const offenders = files.filter((file) =>
      readFileSync(file, 'utf8').includes('dangerouslySetInnerHTML'),
    );
    expect(offenders.map(label)).toEqual([]);
  });

  it('has no float conversion on a total, an amount or a count (NFR-03)', () => {
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const found: string[] = [];
      if (text.includes('parseFloat')) found.push('parseFloat');
      if (text.includes('toFixed')) found.push('toFixed');
      if (label(file) !== BASIS_POINT_FILE && /\bNumber\(/.test(text)) found.push('Number(');
      return found.map((token) => `${label(file)}: ${token}`);
    });
    expect(offenders).toEqual([]);
  });

  it('keeps Number( in the basis-point function only, and never next to a money value', () => {
    const text = readFileSync(join(root, BASIS_POINT_FILE), 'utf8');
    const calls = text.split('\n').filter((line) => /\bNumber\(/.test(line));
    expect(calls).toHaveLength(1);
    // The argument is the basis-point division of two bigint sums, not a bare total or amount.
    expect(calls[0]).toContain('10000n');
  });

  it('writes no hex, rgb, hsl or oklch color literal (D11, AC-24)', () => {
    const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/;
    const offenders = files.filter((file) => literal.test(readFileSync(file, 'utf8')));
    expect(offenders.map(label)).toEqual([]);
  });

  it('imports only packages the web app already declares (D12)', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]);
    const offenders = files.flatMap((file) => {
      const imports = [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map(
        (match) => match[1] ?? '',
      );
      return imports
        .filter((spec) => !spec.startsWith('.') && !spec.startsWith('@/'))
        .filter((spec) => {
          const name = spec.startsWith('@')
            ? spec.split('/').slice(0, 2).join('/')
            : spec.split('/')[0];
          return name !== undefined && !declared.has(name);
        })
        .map((spec) => `${label(file)}: ${spec}`);
    });
    expect(offenders).toEqual([]);
  });
});

/** The commit this branch started from, or undefined where git has no main to compare with. */
function baseCommit(): string | undefined {
  for (const ref of ['origin/main', 'main']) {
    try {
      return execFileSync('git', ['merge-base', 'HEAD', ref], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // Try the next ref.
    }
  }
  return undefined;
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

const base = baseCommit();

describe.skipIf(base === undefined)('what the branch adds against main (AC-24)', () => {
  it('adds no file to apps/api/drizzle: no migration', () => {
    const added = git([
      'diff',
      '--name-status',
      '--diff-filter=AMR',
      `${base}`,
      '--',
      'apps/api/drizzle',
    ])
      .split('\n')
      .filter((line) => line !== '');
    const untracked = git(['ls-files', '--others', '--exclude-standard', 'apps/api/drizzle'])
      .split('\n')
      .filter((line) => line !== '');
    expect([...added, ...untracked]).toEqual([]);
  });

  it('adds no dependency to any package.json', () => {
    const changed = git(['diff', '--name-only', `${base}`, '--', ':(glob)**/package.json'])
      .split('\n')
      .filter((line) => line !== '');
    const offenders = changed.flatMap((path) => {
      const read = (text: string) => {
        const manifest = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
        return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].map(
          (field) => Object.keys(manifest[field] ?? {}),
        );
      };
      const before = read(git(['show', `${base}:${path}`]));
      const after = read(readFileSync(join(root, path), 'utf8'));
      return after.flatMap((names, index) =>
        names.filter((name) => !before[index]?.includes(name)).map((name) => `${path}: ${name}`),
      );
    });
    expect(offenders).toEqual([]);
  });
});
