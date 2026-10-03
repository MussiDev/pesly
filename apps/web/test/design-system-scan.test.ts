import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCANNED_ROOTS = ['src/features', 'src/app', 'src/components'];
const TOKEN_HOME = 'src/components/ui';

const GOOGLE_BUTTON = 'src/features/auth/components/google-sign-in-button.tsx';
// The Google brand colours, the only literals allowed anywhere, and only in the Google button.
const GOOGLE_LOGO_COLOURS = new Set(['#EA4335', '#4285F4', '#FBBC05', '#34A853']);

const COLOUR_LITERAL =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|\b(?:rgb|hsl|oklch)a?\(/g;
// Structural variants (data-[...]:, [&>...]:) and grid templates do not match: none of them is
// in the list of design-value prefixes.
const ARBITRARY_VALUE =
  /\b(?:text|bg|border|ring|p[xytblr]?|m[xytblr]?|gap|space-[xy]|w|h|size|min-w|min-h|rounded|shadow|font|duration|ease|outline|opacity)-\[/g;

/** One message per offending literal or arbitrary-value utility, naming file and line. */
export function scanContent(path: string, text: string): string[] {
  const file = path.replaceAll('\\', '/');
  const allowLogo = file.endsWith(GOOGLE_BUTTON);
  return text.split('\n').flatMap((line, index) => {
    const where = `${file}:${index + 1}`;
    const literals = [...line.matchAll(COLOUR_LITERAL)]
      .map((match) => match[0])
      .filter((literal) => !(allowLogo && GOOGLE_LOGO_COLOURS.has(literal)))
      .map((literal) => `${where}: colour literal ${literal}`);
    const arbitrary = [...line.matchAll(ARBITRARY_VALUE)].map(
      (match) => `${where}: arbitrary value ${match[0]}`,
    );
    return [...literals, ...arbitrary];
  });
}

/** Only .ts/.tsx sources: tests and generated files are not part of the product surface. */
function sources(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (relative(webRoot, child).replaceAll('\\', '/') === TOKEN_HOME) return [];
    if (statSync(child).isDirectory()) return sources(child);
    const isSource = /\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(entry);
    return isSource ? [child] : [];
  });
}

/** Everything the design-system rules apply to; `components/ui/` is where the tokens are consumed. */
function scannedSources(): string[] {
  return SCANNED_ROOTS.flatMap((root) => sources(join(webRoot, root)));
}

describe('design-system scan: pure function (NFR-05, AC-05)', () => {
  it('error: a hex literal planted in a feature file is reported with file and line', () => {
    const text = ['export const a = 1;', 'const c = "#1a2b3c";'].join('\n');

    expect(scanContent('src/features/home/x.tsx', text)).toEqual([
      'src/features/home/x.tsx:2: colour literal #1a2b3c',
    ]);
  });

  it.each([
    '#abc',
    '#aabbcc',
    '#aabbccdd',
    'rgb(1 2 3)',
    'rgba(1, 2, 3, 0.5)',
    'hsl(0 0% 0%)',
    'oklch(0.5 0.1 20)',
  ])('error: reports the colour literal %s', (literal) => {
    expect(scanContent('src/app/page.tsx', `const c = '${literal}';`)).toHaveLength(1);
  });

  it.each([
    'p-[13px]',
    'bg-[var(--x)]',
    'text-[#fff]',
    'min-h-[44px]',
    'rounded-[3px]',
    'ring-[3px]',
    'space-y-[2px]',
    'shadow-[0_0_2px_red]',
  ])('error: an arbitrary-value utility planted in a feature file fails (%s)', (utility) => {
    const text = `<div className="flex ${utility}" />`;
    const found = scanContent('src/features/home/x.tsx', text);

    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0]).toContain('src/features/home/x.tsx:1');
  });

  it.each([
    'data-[state=open]:bg-muted',
    '[&>svg]:size-4',
    'grid-cols-[1fr_auto]',
    'aria-[current=page]:font-semibold',
    'href="#main-content"',
    'const id = "#"',
  ])('does not report structural variants, grid templates or anchors (%s)', (snippet) => {
    expect(scanContent('src/features/home/x.tsx', snippet)).toEqual([]);
  });

  it('allows exactly the four Google logo colours in the Google button', () => {
    const logo = ['#EA4335', '#4285F4', '#FBBC05', '#34A853']
      .map((colour) => `<path fill="${colour}" />`)
      .join('\n');

    expect(scanContent(`apps/web/${GOOGLE_BUTTON}`, logo)).toEqual([]);
  });

  it('error: the allowlist is by colour, not by file: another colour in the Google button fails', () => {
    expect(scanContent(GOOGLE_BUTTON, '<path fill="#123456" />')).toEqual([
      `${GOOGLE_BUTTON}:1: colour literal #123456`,
    ]);
  });

  it('error: the allowlist is by file: a Google colour in another file fails', () => {
    expect(
      scanContent('src/features/auth/components/other.tsx', '<path fill="#EA4335" />'),
    ).toEqual(['src/features/auth/components/other.tsx:1: colour literal #EA4335']);
  });
});

describe('design-system scan: components outside ui (NFR-05)', () => {
  it('error: a colour literal planted in a components file fails with file and line', () => {
    expect(scanContent('src/components/theme-toggle.tsx', 'const c = "rgb(1 2 3)";')).toEqual([
      'src/components/theme-toggle.tsx:1: colour literal rgb(',
    ]);
  });

  it('error: an arbitrary value planted in a components file fails', () => {
    expect(scanContent('src/components/x.tsx', '<div className="p-[7px]" />')).toHaveLength(1);
  });

  it('walks src/components but not src/components/ui', () => {
    const names = scannedSources().map((file) => relative(webRoot, file).replaceAll('\\', '/'));

    expect(names.filter((name) => name.startsWith('src/components/')).length).toBeGreaterThan(0);
    expect(names.filter((name) => name.startsWith('src/components/ui/'))).toEqual([]);
  });
});

describe('design-system scan: the real tree (NFR-05, AC-05)', () => {
  const files = scannedSources();
  const posix = (file: string): string => relative(webRoot, file).replaceAll('\\', '/');

  it('finds the sources to scan, including the design-system page and the locale layout', () => {
    const names = files.map(posix);

    expect(files.length).toBeGreaterThan(50);
    expect(names).toContain('src/app/[locale]/layout.tsx');
    expect(names).toContain('src/app/[locale]/design-system/page.tsx');
    expect(names).toContain('src/app/[locale]/design-system/design-system-showcase.tsx');
    expect(names).toContain(GOOGLE_BUTTON);
    expect(names).toContain('src/components/theme-toggle.tsx');
    expect(names.some((name) => name.startsWith('src/components/ui/'))).toBe(false);
    expect(names.some((name) => name.endsWith('.css'))).toBe(false);
  });

  it('has no colour literal outside the Google logo and no arbitrary design value', () => {
    const offenders = files.flatMap((file) => scanContent(posix(file), readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('still carries the four Google logo colours, so the allowlist entry is not stale', () => {
    const text = readFileSync(join(webRoot, GOOGLE_BUTTON), 'utf8');

    for (const colour of GOOGLE_LOGO_COLOURS) expect(text).toContain(colour);
  });
});
