import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Every file DISC-001-09c touched in the web app and that still exists (NFR-06). */
const SCANNED = [
  'src/features/dashboard',
  'src/features/home/components/quick-actions.tsx',
  'src/features/shell/components/bottom-nav.tsx',
  'src/features/shell/components/top-nav.tsx',
  'src/features/shell/components/more-menu.tsx',
  'src/components/theme-toggle.tsx',
  'src/components/theme-provider.tsx',
  'src/lib/theme.ts',
  'src/lib/use-compact-viewport.ts',
  'src/app/[locale]/(app)/page.tsx',
];

/**
 * The dependency lists of `apps/web/package.json` when 09c started (NFR-05). The slice adds no
 * library: the contrast probe is in-repo (D11), so an accessibility package would show up here.
 */
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

const MONEY_FLOAT = /\bparseFloat\s*\(|\.toFixed\s*\(|\bNumber\s*\(/;

/** One message per line that applies a float conversion; money is never a float. */
export function scanMoney(path: string, text: string): string[] {
  const file = path.replaceAll('\\', '/');
  return text.split('\n').flatMap((line, index) => {
    const found = MONEY_FLOAT.exec(line);
    return found ? [`${file}:${index + 1}: ${found[0].trim()}`] : [];
  });
}

const COLOUR_LITERAL =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|\b(?:rgb|hsl|oklch|oklab|lab|lch)a?\(/g;

/** One message per color literal; every color comes from a theme token. */
export function scanColours(path: string, text: string): string[] {
  const file = path.replaceAll('\\', '/');
  return text
    .split('\n')
    .flatMap((line, index) =>
      [...line.matchAll(COLOUR_LITERAL)].map(
        (match) => `${file}:${index + 1}: colour literal ${match[0]}`,
      ),
    );
}

function sources(path: string): string[] {
  if (!existsSync(path)) return [];
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

describe('dashboard scans: pure functions (NFR-06)', () => {
  it('error: planted JSX text is reported with file and line', () => {
    expect(scanStrings('a.tsx', 'export const A = () => <p>Inicio</p>;')).toEqual([
      'a.tsx:1: JSX text "Inicio"',
    ]);
  });

  it('error: a planted aria-label literal is reported', () => {
    expect(scanStrings('a.tsx', 'export const A = () => <p aria-label="Home" />;')).toEqual([
      'a.tsx:1: aria-label attribute "Home"',
    ]);
  });

  it.each(['parseFloat(x)', 'x.toFixed(2)', 'Number(x)'])('error: reports %s', (call) => {
    expect(scanMoney('a.ts', `const a = ${call};`)).toHaveLength(1);
  });

  it.each(['#abc', '#aabbcc', 'rgb(1 2 3)', 'hsl(0 0% 0%)', 'oklch(0.5 0.1 20)'])(
    'error: reports the colour literal %s',
    (literal) => {
      expect(scanColours('a.ts', `const c = '${literal}';`)).toHaveLength(1);
    },
  );
});

describe('dashboard scans: the touched files (NFR-06)', () => {
  const files = SCANNED.flatMap((entry) => sources(join(webRoot, entry)));
  const names = files.map((file) => relative(webRoot, file).replaceAll('\\', '/'));

  it('finds the dashboard feature, the theme control and the shell files', () => {
    expect(names).toContain('src/features/dashboard/containers/dashboard-container.tsx');
    expect(names).toContain('src/features/dashboard/components/net-worth-card.tsx');
    expect(names).toContain('src/features/dashboard/contract/dashboard-adapter.ts');
    expect(names).toContain('src/components/theme-toggle.tsx');
    expect(names).toContain('src/features/shell/components/more-menu.tsx');
    expect(names).toContain('src/features/home/components/quick-actions.tsx');
    expect(names).toContain('src/app/[locale]/(app)/page.tsx');
  });

  it('has no hardcoded user-facing string', () => {
    const offenders = files
      .filter((file) => file.endsWith('.tsx'))
      .flatMap((file) => scanStrings(relative(webRoot, file), readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('applies no parseFloat, toFixed or Number( in a touched file', () => {
    const offenders = files.flatMap((file) =>
      scanMoney(relative(webRoot, file), readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });

  it('has no colour literal in a touched file', () => {
    const offenders = files.flatMap((file) =>
      scanColours(relative(webRoot, file), readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});

describe('the dashboard contract (spec D1)', () => {
  it('comes from @pesly/shared: the provisional local copy is gone', () => {
    expect(existsSync(join(webRoot, 'src/lib/dashboard-contract.ts'))).toBe(false);
  });
});

describe('the dependency lists of apps/web/package.json (NFR-05)', () => {
  it('keeps the runtime dependencies as they were', () => {
    expect(readJson('package.json').dependencies).toEqual(RUNTIME_DEPENDENCIES);
  });

  it('adds no development dependency either: no accessibility library (D11)', () => {
    expect(readJson('package.json').devDependencies).toEqual(DEV_DEPENDENCIES);
  });
});

describe('the catalogs after the cleanup of the old home (NFR-06)', () => {
  const LOCALES = ['es', 'en'] as const;

  function keysOf(value: unknown): string[] {
    return typeof value === 'object' && value !== null ? Object.keys(value) : [];
  }

  it.each(LOCALES)('keeps only the quick actions under "home" in %s', (locale) => {
    const catalog = readJson(`messages/${locale}.json`);
    const home = catalog.home as Record<string, unknown>;

    expect(keysOf(home)).toEqual(['quickActions']);
    expect(keysOf(home.quickActions).sort()).toEqual(
      ['label', 'expense', 'income', 'transfer', 'exchange'].sort(),
    );
  });

  it.each(LOCALES)(
    'keeps only the three theme options and the label under "theme" in %s',
    (locale) => {
      const theme = readJson(`messages/${locale}.json`).theme;

      expect(keysOf(theme).sort()).toEqual(['dark', 'label', 'light', 'system']);
    },
  );

  it('reads no "home" namespace other than the quick actions, and no theme.darkMode', () => {
    const everySource = sources(join(webRoot, 'src'));
    const namespaces = everySource.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/useTranslations\(\s*'(home[^']*)'/g)].map(
        (match) => match[1],
      ),
    );
    const darkMode = everySource.filter((file) => readFileSync(file, 'utf8').includes('darkMode'));

    expect(new Set(namespaces)).toEqual(new Set(['home.quickActions']));
    expect(darkMode.map((file) => relative(webRoot, file))).toEqual([]);
  });
});
