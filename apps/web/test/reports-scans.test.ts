import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The new reports files of DISC-001-09d: the feature and the three route pages (NFR-06, NFR-07). */
const SCANNED = ['src/features/reports', 'src/app/[locale]/(app)/reports'];

/** The dependency lists of `apps/web/package.json` on main: the slice adds no library (NFR-07). */
const RUNTIME_DEPENDENCIES = {
  '@pesly/shared': 'workspace:*',
  '@serwist/turbopack': '9.5.12',
  'class-variance-authority': '^0.7.1',
  clsx: '^2.1.1',
  esbuild: '0.28.2',
  'lucide-react': '^1.48.0',
  next: '^16.4.1',
  'next-intl': '^4.14.7',
  'pdfjs-dist': '6.3.289',
  qrcode: '^1.5.4',
  react: '^19.3.0',
  'react-dom': '^19.3.0',
  'read-excel-file': '9.3.10',
  serwist: '9.5.12',
  'tailwind-merge': '^3.7.0',
  zod: '^4.6.6',
};

const DEV_DEPENDENCIES = {
  '@tailwindcss/postcss': '^4.3.3',
  '@testing-library/dom': '^10.4.2',
  '@testing-library/react': '^16.3.3',
  '@testing-library/user-event': '^14.6.7',
  '@types/node': '^24.13.6',
  '@types/qrcode': '^1.5.6',
  '@types/react': '^19.3.0',
  '@types/react-dom': '^19.3.0',
  'fake-indexeddb': '^6.2.5',
  'happy-dom': '^20.14.5',
  tailwindcss: '^4.3.3',
  'write-excel-file': '4.1.1',
};

const USER_FACING_ATTRIBUTES = new Set(['aria-label', 'placeholder', 'title', 'alt', 'label']);
const HAS_LETTER = /\p{L}/u;

function literalText(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return literalText(node.expression);
  return undefined;
}

/** One message per JSX text, string child or user-facing attribute literal that holds a letter. */
export function scanStrings(path: string, text: string): string[] {
  const file = path.replaceAll('\\', '/');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const report = (node: ts.Node, kind: string, value: string): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${file}:${line + 1}: ${kind} "${value.trim().replaceAll(/\s+/g, ' ')}"`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && HAS_LETTER.test(node.text)) {
      report(node, 'JSX text', node.text);
    } else if (ts.isJsxExpression(node) && ts.isJsxElement(node.parent)) {
      const value = literalText(node);
      if (value !== undefined && HAS_LETTER.test(value)) report(node, 'JSX string', value);
    } else if (ts.isJsxAttribute(node) && USER_FACING_ATTRIBUTES.has(node.name.getText(source))) {
      const value = literalText(node.initializer);
      if (value !== undefined && HAS_LETTER.test(value)) {
        report(node, `${node.name.getText(source)} attribute`, value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Drops comments so a "why" note that names a forbidden construct is not a false positive. */
function withoutComments(text: string): string {
  return text
    .replaceAll(/\/\*[\s\S]*?\*\//g, (block) => block.replaceAll(/[^\n]/g, ' '))
    .replaceAll(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** One message per line that matches the pattern; the file and line make the message actionable. */
export function scanPattern(path: string, text: string, pattern: RegExp): string[] {
  const file = path.replaceAll('\\', '/');
  return withoutComments(text)
    .split('\n')
    .flatMap((line, index) => {
      const found = pattern.exec(line);
      return found ? [`${file}:${index + 1}: ${found[0].trim()}`] : [];
    });
}

/**
 * Bounded bigint-to-number conversions that are not an amount: a permille (0..1000) that sizes a bar
 * and a slot index that picks a text. Each is reviewed by hand; any other `Number(` fails the scan.
 */
const BOUNDED_NUMBER_CONVERSIONS = [
  'src/features/reports/categories/category-ring.tsx:',
  'src/features/reports/income-expenses/month-bars.tsx:',
];

const STORAGE = /\b(?:localStorage|sessionStorage|indexedDB)\b|\bcaches\.|\bserviceWorker\b/;
const RAW_HTML_OR_LOG = /\bdangerouslySetInnerHTML\b|\binnerHTML\b|\bconsole\./;
const MONEY_FLOAT = /\bparseFloat\s*\(|\.toFixed\s*\(|\bNumber\s*\(/;
const COLOUR_LITERAL =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|\b(?:rgb|hsl|oklch|oklab|lab|lch)a?\(/;

/** Every source file under the path; a missing path is an error that names it, never a skip. */
function sources(path: string): string[] {
  if (!existsSync(path)) throw new Error(`Scanned source not found: ${path}`);
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) return sources(child);
    return /\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) ? [child] : [];
  });
}

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(webRoot, relativePath), 'utf8')) as Record<string, unknown>;
}

const files = SCANNED.flatMap((entry) => sources(join(webRoot, entry)));
const scan = (pattern: RegExp): string[] =>
  files.flatMap((file) =>
    scanPattern(relative(webRoot, file), readFileSync(file, 'utf8'), pattern),
  );

describe('reports scans: pure functions (NFR-06, NFR-07)', () => {
  it('error: planted JSX text and aria-label literals are reported with file and line', () => {
    expect(scanStrings('a.tsx', 'export const A = () => <p>Informes</p>;')).toEqual([
      'a.tsx:1: JSX text "Informes"',
    ]);
    expect(scanStrings('a.tsx', 'export const A = () => <p aria-label="Home" />;')).toEqual([
      'a.tsx:1: aria-label attribute "Home"',
    ]);
  });

  it.each(['localStorage.x', 'sessionStorage.x', 'indexedDB.open()', 'caches.open()'])(
    'error: reports the storage call %s',
    (call) => {
      expect(scanPattern('a.ts', `const a = ${call};`, STORAGE)).toHaveLength(1);
    },
  );

  it.each(['dangerouslySetInnerHTML', 'el.innerHTML', 'console.log(1)'])(
    'error: reports %s',
    (call) => {
      expect(scanPattern('a.ts', `const a = ${call};`, RAW_HTML_OR_LOG)).toHaveLength(1);
    },
  );

  it.each(['parseFloat(x)', 'x.toFixed(2)', 'Number(x)'])('error: reports %s', (call) => {
    expect(scanPattern('a.ts', `const a = ${call};`, MONEY_FLOAT)).toHaveLength(1);
  });

  it.each(['#abc', '#aabbcc', 'rgb(1 2 3)', 'hsl(0 0% 0%)'])(
    'error: reports the colour literal %s',
    (literal) => {
      expect(scanPattern('a.ts', `const c = '${literal}';`, COLOUR_LITERAL)).toHaveLength(1);
    },
  );

  it('ignores a forbidden name that only appears in a comment', () => {
    expect(scanPattern('a.ts', '// never use localStorage here\nconst a = 1;', STORAGE)).toEqual(
      [],
    );
  });

  it('error: a missing source file fails with its path in the message', () => {
    const missing = join(webRoot, 'src/features/reports/does-not-exist.tsx');

    expect(() => sources(missing)).toThrow(missing);
  });
});

describe('reports scans: the new files (NFR-06, NFR-07)', () => {
  const names = files.map((file) => relative(webRoot, file).replaceAll('\\', '/'));

  it('finds the feature and the route pages', () => {
    expect(names).toContain('src/features/reports/use-report.ts');
    expect(names).toContain('src/features/reports/net-worth/net-worth-container.tsx');
    expect(names).toContain('src/app/[locale]/(app)/reports/layout.tsx');
    expect(names).toContain('src/app/[locale]/(app)/reports/categories/page.tsx');
  });

  it('has no storage, cache or service worker call (NFR-07)', () => {
    expect(scan(STORAGE)).toEqual([]);
  });

  it('has no raw HTML insertion and no logging (NFR-07)', () => {
    expect(scan(RAW_HTML_OR_LOG)).toEqual([]);
  });

  it('applies no parseFloat, toFixed or Number( on money (NFR-06)', () => {
    expect(
      scan(MONEY_FLOAT).filter(
        (hit) => !BOUNDED_NUMBER_CONVERSIONS.some((ok) => hit.startsWith(ok)),
      ),
    ).toEqual([]);
  });

  it('has no hardcoded visible string and no colour literal (NFR-06, NFR-04)', () => {
    const strings = files
      .filter((file) => file.endsWith('.tsx'))
      .flatMap((file) => scanStrings(relative(webRoot, file), readFileSync(file, 'utf8')));

    expect(strings).toEqual([]);
    expect(scan(COLOUR_LITERAL)).toEqual([]);
  });

  it('adds no rule for the reports calls to the service worker (NFR-07)', () => {
    const sw = readFileSync(join(webRoot, 'src/app/sw.ts'), 'utf8');

    expect(sw).not.toMatch(/['"`/]reports(?![a-z])/i);
  });
});

describe('the dependency lists of apps/web/package.json (NFR-07)', () => {
  it('keeps the runtime dependencies as they are on main', () => {
    expect(readJson('package.json').dependencies).toEqual(RUNTIME_DEPENDENCIES);
  });

  it('keeps the development dependencies as they are on main', () => {
    expect(readJson('package.json').devDependencies).toEqual(DEV_DEPENDENCIES);
  });
});

describe('every functional requirement is named by a test (NFR-09)', () => {
  const TITLE =
    /\b(?:it|test|describe)(?:\.\w+)*(?:\.each\([^)]*\))?\(\s*(['"`])((?:(?!\1)[\s\S])*)\1/g;
  const testsDir = join(webRoot, 'test');
  const e2eDir = join(webRoot, 'e2e');

  /** Block 8 lands in parallel: its specs count when they exist and add nothing when they do not. */
  const testFiles = [
    ...readdirSync(testsDir)
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => join(testsDir, name)),
    ...(existsSync(e2eDir)
      ? readdirSync(e2eDir)
          .filter((name) => /^reports.*\.spec\.ts$/.test(name))
          .map((name) => join(e2eDir, name))
      : []),
  ];

  it('finds the test files that carry the ids', () => {
    expect(testFiles.length).toBeGreaterThan(5);
  });

  it('names FR-01 to FR-23 in at least one test or suite title', () => {
    const titles = testFiles
      .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(TITLE)].map((match) => match[2]))
      .join('\n');
    const missing = Array.from(
      { length: 23 },
      (_, index) => `FR-${String(index + 1).padStart(2, '0')}`,
    ).filter((id) => !new RegExp(`\\b${id}\\b`).test(titles));

    expect(missing).toEqual([]);
  });
});
