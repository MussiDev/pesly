import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = resolve(__dirname, '..', '..', 'src');
const moduleRoot = join(srcRoot, 'dashboard');
/** The modules the dashboard reads; each is reached through its barrel only (D1). */
const SOURCE_MODULES = [
  'reports',
  'budgets',
  'recurring',
  'credit-cards',
  'investments',
  'groups',
  'movements',
];
/** The one file allowed to import other modules' tables. */
const FOREIGN_RELATIONS = join(moduleRoot, 'infrastructure', 'db', 'foreign-relations.ts');

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

/** Where a relative import lands, as a path under `src` without extension; null for a package. */
function resolveImport(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  return resolve(dirname(file), specifier);
}

interface Violation {
  file: string;
  specifier: string;
  rule: string;
}

function violationsOf(file: string, source: string): Violation[] {
  const layer = relative(moduleRoot, file).split(sep)[0];
  const found: Violation[] = [];
  for (const specifier of importsOf(source)) {
    const target = resolveImport(file, specifier);
    if (target === null) continue;
    const inSrc = relative(srcRoot, target).split(sep);
    const name = file.slice(srcRoot.length + 1);
    if (inSrc[0] === 'dashboard') {
      if ((layer === 'domain' || layer === 'application') && inSrc[1] === 'infrastructure') {
        found.push({
          file: name,
          specifier,
          rule: 'domain and application import no infrastructure',
        });
      }
      continue;
    }
    if (file === FOREIGN_RELATIONS) continue;
    if (inSrc[0] !== undefined && SOURCE_MODULES.includes(inSrc[0])) {
      const isBarrel = inSrc.length === 1 || (inSrc.length === 2 && inSrc[1] === 'index');
      if (!isBarrel)
        found.push({ file: name, specifier, rule: 'other modules only through their barrel' });
      continue;
    }
    if (inSrc[0] !== undefined && !['shared', 'app'].includes(inSrc[0])) {
      found.push({
        file: name,
        specifier,
        rule: 'tables of other modules only in foreign-relations',
      });
    }
  }
  return found;
}

describe('the dashboard module boundaries (D1)', () => {
  const files = filesUnder(moduleRoot);

  it('scans the whole module', () => {
    expect(files.length).toBeGreaterThan(25);
  });

  it('imports other modules only through their barrels and their tables only in foreign-relations', () => {
    const violations = files.flatMap((file) => violationsOf(file, readFileSync(file, 'utf8')));
    expect(violations).toEqual([]);
  });

  it('keeps the domain and application layers free of infrastructure imports', () => {
    const offenders = files
      .filter((file) =>
        ['domain', 'application'].includes(relative(moduleRoot, file).split(sep)[0] ?? ''),
      )
      .flatMap((file) => violationsOf(file, readFileSync(file, 'utf8')))
      .filter((violation) => violation.rule.includes('infrastructure'));
    expect(offenders).toEqual([]);
  });

  it('the scan catches a planted deep import, a foreign table and an infrastructure import', () => {
    const application = join(moduleRoot, 'application', 'planted.ts');
    const infra = join(moduleRoot, 'infrastructure', 'http', 'planted.ts');
    expect(
      violationsOf(application, "import { x } from '../../reports/application/ports/clock';"),
    ).toHaveLength(1);
    expect(
      violationsOf(application, "import { x } from '../infrastructure/db/foreign-relations';"),
    ).toHaveLength(1);
    expect(
      violationsOf(infra, "import { accounts } from '../../../accounts/infrastructure/db/schema';"),
    ).toHaveLength(1);
    expect(violationsOf(infra, "import { accounts } from '../../../reports';")).toEqual([]);
    expect(
      violationsOf(
        FOREIGN_RELATIONS,
        "export { a } from '../../../accounts/infrastructure/db/schema';",
      ),
    ).toEqual([]);
  });
});
