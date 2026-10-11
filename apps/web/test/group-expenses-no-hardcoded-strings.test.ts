import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCANNED = [
  'src/features/groups/expenses',
  'src/features/groups/split',
  'src/features/groups/default-split',
  'src/features/groups/shares',
  'src/features/groups/containers/group-detail-container.tsx',
  'src/app/[locale]/(app)/groups',
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

/**
 * Percentages are basis points read from validated digit strings (`^\d{1,3}(\.\d{1,2})?$`), so
 * `Number(` there converts small integers, never money.
 */
const NOT_MONEY = new Set(['src/features/groups/split/percentage-input.ts']);

const MONEY_FLOAT = /\bparseFloat\s*\(|\.toFixed\s*\(|\bNumber\s*\(/;

/** One message per line that applies a float conversion to a value; money is never a float. */
export function scanMoney(path: string, text: string): string[] {
  const file = path.replaceAll('\\', '/');
  if (NOT_MONEY.has(file)) return [];
  return text.split('\n').flatMap((line, index) => {
    const found = MONEY_FLOAT.exec(line);
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

describe('group expenses scans: pure functions (NFR-05)', () => {
  it('error: parseFloat, toFixed and Number( are reported with file and line', () => {
    const text = [
      'const a = 1;',
      'const b = parseFloat(amount);',
      'const c = total.toFixed(2);',
      'const d = Number(share);',
    ].join('\n');

    expect(scanMoney('a.ts', text)).toEqual([
      'a.ts:2: parseFloat(',
      'a.ts:3: .toFixed(',
      'a.ts:4: Number(',
    ]);
  });

  it('does not report BigInt, Number.isInteger or identifiers that merely end in Number', () => {
    const text = ['const a = BigInt(x);', 'const b = lineNumber(y);'].join('\n');

    expect(scanMoney('a.ts', text)).toEqual([]);
  });
});

describe('group expenses string scan: pure function (NFR-05)', () => {
  it('error: JSX text planted in a component is reported with file and line', () => {
    const text = ['export const A = () => (', '  <p>New expense</p>', ');'].join('\n');

    expect(scanStrings('a.tsx', text)).toEqual(['a.tsx:2: JSX text "New expense"']);
  });

  it('does not report catalog text', () => {
    expect(scanStrings('a.tsx', 'export const A = () => <p>{t("title")}</p>;')).toEqual([]);
  });
});

describe('group expenses scans: the real tree (NFR-05)', () => {
  const files = SCANNED.flatMap((root) => sources(join(webRoot, root)));
  const names = files.map((file) => relative(webRoot, file).replaceAll('\\', '/'));

  it('finds the new screens, the pages and the detail container', () => {
    expect(names).toContain('src/features/groups/expenses/list/group-expenses-container.tsx');
    expect(names).toContain('src/features/groups/expenses/form/expense-form-container.tsx');
    expect(names).toContain('src/features/groups/default-split/default-split-container.tsx');
    expect(names).toContain('src/features/groups/shares/personal-shares-container.tsx');
    expect(names).toContain('src/app/[locale]/(app)/groups/[id]/expenses/page.tsx');
    expect(names).toContain('src/app/[locale]/(app)/groups/[id]/expenses/new/page.tsx');
    expect(names).toContain('src/app/[locale]/(app)/groups/[id]/default-split/page.tsx');
    expect(names).toContain('src/app/[locale]/(app)/groups/shares/page.tsx');
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
});
