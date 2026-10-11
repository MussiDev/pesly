import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const GROUPS_ROOT = 'src/features/groups';

/** Attributes whose value a person reads or hears. */
const USER_FACING_ATTRIBUTES = new Set(['aria-label', 'placeholder', 'title', 'alt', 'label']);

const HAS_LETTER = /\p{L}/u;

function literalText(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return literalText(node.expression);
  return undefined;
}

/**
 * One message per JSX text, string child or user-facing attribute with a literal that holds a
 * letter; text that comes from `t()` or a variable is an expression and is never reported.
 */
export function scanContent(path: string, text: string): string[] {
  const file = path.replaceAll('\\', '/');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];

  function report(node: ts.Node, kind: string, value: string): void {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${file}:${line + 1}: ${kind} "${value.trim().replaceAll(/\s+/g, ' ')}"`);
  }

  function visit(node: ts.Node): void {
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
  }

  visit(source);
  return found;
}

function sources(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) return sources(child);
    return /\.tsx$/.test(entry) && !/\.(test|spec)\.tsx$/.test(entry) ? [child] : [];
  });
}

describe('groups scan: pure function (AC-20)', () => {
  it('error: JSX text planted in a component is reported with file and line', () => {
    const text = ['export const A = () => (', '  <p>Hello group</p>', ');'].join('\n');

    expect(scanContent('src/features/groups/components/a.tsx', text)).toEqual([
      'src/features/groups/components/a.tsx:2: JSX text "Hello group"',
    ]);
  });

  it.each(['aria-label', 'placeholder', 'title'])(
    'error: a literal %s attribute is reported',
    (attribute) => {
      const text = `export const A = () => <input ${attribute}="Nombre" />;`;

      expect(scanContent('a.tsx', text)).toEqual([`a.tsx:1: ${attribute} attribute "Nombre"`]);
    },
  );

  it('error: a literal inside a braced attribute or child is reported', () => {
    const text = [
      'export const A = () => (',
      "  <button aria-label={'Cerrar'}>{'Salir'}</button>",
      ');',
    ].join('\n');

    expect(scanContent('a.tsx', text)).toEqual([
      'a.tsx:2: aria-label attribute "Cerrar"',
      'a.tsx:2: JSX string "Salir"',
    ]);
  });

  it('does not report catalog text, symbols, numbers or non-text attributes', () => {
    const text = [
      'export const A = () => (',
      '  <div className="grid gap-2" data-slot="group-panels" aria-label={t("title")}>',
      '    <span>{t("name")}</span>',
      '    <span>·</span>',
      '    <span>{count}</span>',
      '    <input type="text" name="displayName" autoComplete="off" />',
      '  </div>',
      ');',
    ].join('\n');

    expect(scanContent('a.tsx', text)).toEqual([]);
  });
});

describe('groups scan: the real tree (AC-20)', () => {
  const files = sources(join(webRoot, GROUPS_ROOT));

  it('finds the components and containers of the groups screens', () => {
    const names = files.map((file) => relative(webRoot, file).replaceAll('\\', '/'));

    expect(files.length).toBeGreaterThan(15);
    expect(names).toContain('src/features/groups/components/groups-list.tsx');
    expect(names).toContain('src/features/groups/containers/group-detail-container.tsx');
  });

  it('has no hardcoded user-facing string in components or containers', () => {
    const offenders = files.flatMap((file) =>
      scanContent(relative(webRoot, file), readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
