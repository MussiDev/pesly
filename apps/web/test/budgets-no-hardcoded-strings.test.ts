import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCANNED = [
  'src/features/budgets',
  'src/app/[locale]/(app)/budgets',
  'src/features/notices/components/notice-list.tsx',
];

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

/** One message per line that applies a float conversion to a value; money is never a float. */
export function scanMoney(path: string, text: string): string[] {
  const file = path.replaceAll('\\', '/');
  return text.split('\n').flatMap((line, index) => {
    const found = MONEY_FLOAT.exec(line);
    return found ? [`${file}:${index + 1}: ${found[0].trim()}`] : [];
  });
}

/**
 * Arithmetic on figures: a percentage or an amount is shown as the API returned it (D3). The one
 * allowed division is `percent / 100` (or `value / 100` for a threshold), which only rescales a
 * whole percentage into the fraction the locale percent formatter expects; it derives nothing.
 */
const ARITHMETIC =
  /\bMath\.(round|floor|ceil|trunc)\s*\(|\*\s*100\b|(?<!\b(?:percent|percentage|value)\s*)\/\s*100\b|\bBigInt\([^)]*\)\s*[-+*/%]/;

/** One message per line that derives a percentage or an amount on the client. */
export function scanArithmetic(path: string, text: string): string[] {
  const file = path.replaceAll('\\', '/');
  return text.split('\n').flatMap((line, index) => {
    const found = ARITHMETIC.exec(line);
    return found ? [`${file}:${index + 1}: ${found[0].trim()}`] : [];
  });
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

describe('budgets scans: pure functions (NFR-04)', () => {
  it('error: planted arithmetic on a percentage is reported with file and line', () => {
    const text = ['const a = 1;', 'const p = Math.round(saved * 100 / target);'].join('\n');

    expect(scanArithmetic('a.ts', text)).toEqual(['a.ts:2: Math.round(']);
  });

  it('error: planted JSX text is reported', () => {
    expect(scanStrings('a.tsx', 'export const A = () => <p>Goals</p>;')).toEqual([
      'a.tsx:1: JSX text "Goals"',
    ]);
  });

  it('error: planted division of an amount by 100 is reported, the percent rescale is not', () => {
    expect(scanArithmetic('a.ts', 'const a = spent / 100;')).toEqual(['a.ts:1: / 100']);
    expect(scanArithmetic('a.ts', 'const a = percent / 100;')).toEqual([]);
    expect(scanArithmetic('a.ts', 'const a = marker.value / 100;')).toEqual([]);
  });

  it('error: planted parseFloat on an amount is reported', () => {
    expect(scanMoney('a.ts', 'const a = parseFloat(x);')).toEqual(['a.ts:1: parseFloat(']);
  });
});

describe('budgets scans: the real tree (NFR-04)', () => {
  const files = SCANNED.flatMap((root) => sources(join(webRoot, root)));
  const names = files.map((file) => relative(webRoot, file).replaceAll('\\', '/'));

  it('finds the containers, the four pages and the notice list', () => {
    expect(names).toContain('src/features/budgets/list/budgets-container.tsx');
    expect(names).toContain('src/features/budgets/detail/budget-detail-container.tsx');
    expect(names).toContain('src/features/budgets/form/create-budget-container.tsx');
    expect(names).toContain('src/features/budgets/form/edit-budget-container.tsx');
    expect(names).toContain('src/app/[locale]/(app)/budgets/page.tsx');
    expect(names).toContain('src/app/[locale]/(app)/budgets/new/page.tsx');
    expect(names).toContain('src/app/[locale]/(app)/budgets/[id]/page.tsx');
    expect(names).toContain('src/app/[locale]/(app)/budgets/[id]/edit/page.tsx');
    expect(names).toContain('src/features/notices/components/notice-list.tsx');
  });

  it('has no hardcoded user-facing string', () => {
    const offenders = files
      .filter((file) => file.endsWith('.tsx'))
      .flatMap((file) => scanStrings(relative(webRoot, file), readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('applies no parseFloat, toFixed or Number( to money', () => {
    const offenders = files.flatMap((file) =>
      scanMoney(relative(webRoot, file), readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });

  it('derives no percentage or amount on the client', () => {
    const offenders = files.flatMap((file) =>
      scanArithmetic(relative(webRoot, file), readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
