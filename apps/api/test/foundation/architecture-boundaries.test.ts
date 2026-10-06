import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

// Lints virtual files with the repository's real ESLint config, keeping only the boundary rule
// (type-aware parsing is switched off because the files do not exist on disk).
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfig: { languageOptions: { parserOptions: { projectService: false, project: null } } },
  ruleFilter: ({ ruleId }) => ruleId === 'no-restricted-imports',
});

// The first lint loads the config and its plugins, which takes several seconds under a full run;
// paying it here keeps that cost out of whichever test happens to come first.
beforeAll(async () => {
  await eslint.lintText('\n', { filePath: `${repoRoot}apps/api/src/warm-up.ts` });
}, 60_000);

async function restrictedImports(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: `${repoRoot}${filePath}` });
  return (result?.messages ?? []).map((message) => message.ruleId ?? `fatal: ${message.message}`);
}

const DOMAIN_FILE = 'apps/api/src/identity/domain/probe.ts';
const APPLICATION_FILE = 'apps/api/src/identity/application/probe.ts';

const INVESTMENTS_DOMAIN_FILE = 'apps/api/src/investments/domain/probe.ts';
const INVESTMENTS_APPLICATION_FILE = 'apps/api/src/investments/application/probe.ts';

describe('credit-cards module import boundaries', () => {
  it.each([
    [
      'apps/api/src/credit-cards/domain/probe.ts',
      "import { x } from '../infrastructure/db/schema';",
    ],
    ['apps/api/src/credit-cards/domain/probe.ts', "import { eq } from 'drizzle-orm';"],
    [
      'apps/api/src/credit-cards/application/probe.ts',
      "import { x } from '../infrastructure/db/schema';",
    ],
    ['apps/api/src/credit-cards/domain/probe.ts', "import express from 'express';"],
  ])('rejects in %s: %s (sad path)', async (file, source) => {
    expect(await restrictedImports(file, `${source}\n`)).toEqual(['no-restricted-imports']);
  });

  it('allows credit-cards domain and application to import shared code and the access port', async () => {
    expect(
      await restrictedImports(
        'apps/api/src/credit-cards/application/probe.ts',
        "import type { AccessScope } from '../../shared/access';\nimport { y } from '../domain/credit-card';\n",
      ),
    ).toEqual([]);
  });
});

describe('investments module import boundaries', () => {
  it.each([
    "import { x } from '../infrastructure/db/schema';",
    "import { eq } from 'drizzle-orm';",
    "import express from 'express';",
    "import { randomUUID } from 'node:crypto';",
  ])('rejects in investments domain: %s', async (source) => {
    expect(await restrictedImports(INVESTMENTS_DOMAIN_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it('rejects infrastructure imports in investments application', async () => {
    expect(
      await restrictedImports(
        INVESTMENTS_APPLICATION_FILE,
        "import { x } from '../infrastructure/db/schema';\n",
      ),
    ).toEqual(['no-restricted-imports']);
  });

  it('allows investments domain and application to import shared code and the access port', async () => {
    expect(
      await restrictedImports(
        INVESTMENTS_DOMAIN_FILE,
        "import { AppError } from '@pesly/shared';\nimport { y } from './holding';\n",
      ),
    ).toEqual([]);
    expect(
      await restrictedImports(
        INVESTMENTS_APPLICATION_FILE,
        "import type { AccessScope } from '../../shared/access';\nimport { y } from '../domain/holding';\n",
      ),
    ).toEqual([]);
  });
});

describe('hexagonal import boundaries in the movements module', () => {
  const MOVEMENTS_DOMAIN_FILE = 'apps/api/src/movements/domain/probe.ts';
  const MOVEMENTS_APPLICATION_FILE = 'apps/api/src/movements/application/probe.ts';

  it.each([
    "import { x } from '../infrastructure/db/schema';",
    "import { eq } from 'drizzle-orm';",
    "import pg from 'pg';",
    "import express from 'express';",
    "import { randomUUID } from 'node:crypto';",
  ])('rejects in movements domain: %s', async (source) => {
    expect(await restrictedImports(MOVEMENTS_DOMAIN_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it.each([
    "import { movements } from '../infrastructure/db/schema';",
    "import { x } from '../infrastructure/http/movement-routes';",
    "import { x } from '../infrastructure/system-clock';",
  ])('rejects infrastructure imports in movements application: %s', async (source) => {
    expect(await restrictedImports(MOVEMENTS_APPLICATION_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it.each([
    [
      'apps/api/src/movements/application/suggest-tags.ts',
      "import { tags } from '../infrastructure/db/tags-schema';",
    ],
    [
      'apps/api/src/movements/application/ports/tag-repository.ts',
      "import { x } from '../../infrastructure/db/drizzle-tag-repository';",
    ],
    [
      'apps/api/src/movements/application/list-movements.ts',
      "import { movementConditions } from '../infrastructure/db/drizzle-movement-filters';",
    ],
    [
      'apps/api/src/movements/application/local-day-range.ts',
      "import { x } from '../infrastructure/http/tag-routes';",
    ],
    [
      'apps/api/src/movements/domain/movement.ts',
      "import { tags } from '../infrastructure/db/tags-schema';",
    ],
    ['apps/api/src/movements/domain/movement.ts', "import { sql } from 'drizzle-orm';"],
  ])(
    'rejects infrastructure and runtime imports in the tags and filters file %s: %s',
    async (file, source) => {
      expect(
        await restrictedImports(
          file,
          `${source}
`,
        ),
      ).toEqual(['no-restricted-imports']);
    },
  );

  it('allows movements domain and application to import shared code, ports and the access port', async () => {
    expect(
      await restrictedImports(
        MOVEMENTS_DOMAIN_FILE,
        "import { AppError } from '@pesly/shared';\nimport { y } from './errors';\n",
      ),
    ).toEqual([]);
    expect(
      await restrictedImports(
        MOVEMENTS_APPLICATION_FILE,
        "import type { AccessScope } from '../../shared/access';\nimport { y } from '../domain/movement';\nimport type { Clock } from './ports/clock';\n",
      ),
    ).toEqual([]);
  });
});

describe('hexagonal import boundaries', () => {
  it.each([
    "import { x } from '../infrastructure/db/schema';",
    "import { eq } from 'drizzle-orm';",
    "import pg from 'pg';",
    "import express from 'express';",
    "import { SignJWT } from 'jose';",
    "import { hash } from '@node-rs/argon2';",
    "import { Resend } from 'resend';",
    "import { randomUUID } from 'node:crypto';",
  ])('rejects in domain: %s', async (source) => {
    expect(await restrictedImports(DOMAIN_FILE, `${source}\n`)).toEqual(['no-restricted-imports']);
  });

  it('rejects infrastructure imports in application', async () => {
    expect(
      await restrictedImports(
        APPLICATION_FILE,
        "import { x } from '../infrastructure/db/schema';\n",
      ),
    ).toEqual(['no-restricted-imports']);
  });

  it('allows domain code to import shared schemas and other domain files', async () => {
    const source =
      "import { z } from 'zod';\nimport { AppError } from '@pesly/shared';\nimport { y } from './email';\n";
    expect(await restrictedImports(DOMAIN_FILE, source)).toEqual([]);
  });

  it.each([
    ['apps/api/src/app.ts', "import { x } from '../test/fixtures/fixture-resource-routes';\n"],
    ['apps/api/src/shared/access/probe.ts', "import { x } from '../../../test/helpers/x';\n"],
    [DOMAIN_FILE, "import { x } from '../../../test/fakes/mutable-clock';\n"],
    [APPLICATION_FILE, "import { x } from '../../../test/fakes/mutable-clock';\n"],
  ])('rejects test-code imports from production code: %s', async (file, source) => {
    expect(await restrictedImports(file, source)).toEqual(['no-restricted-imports']);
  });

  it('keeps rejecting infrastructure imports in domain alongside the test-code rule', async () => {
    expect(
      await restrictedImports(DOMAIN_FILE, "import { x } from '../infrastructure/db/schema';\n"),
    ).toEqual(['no-restricted-imports']);
  });

  it('allows test code to import test code and production code', async () => {
    const source =
      "import { x } from '../fixtures/fixture-resource-routes';\nimport { y } from '../../src/app';\n";
    expect(await restrictedImports('apps/api/test/access/probe.test.ts', source)).toEqual([]);
  });

  it.each([
    "import { scopedTo } from '../../shared/access/infrastructure/drizzle-access-scope';",
    "import { DenyAllGroupMembershipReader } from '../../shared/access/infrastructure/deny-all-group-membership-reader';",
  ])('rejects shared access infrastructure in application: %s', async (source) => {
    expect(await restrictedImports(APPLICATION_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it('allows application code to import the shared access port', async () => {
    const source = "import type { AccessScope } from '../../shared/access';\n";
    expect(await restrictedImports(APPLICATION_FILE, source)).toEqual([]);
  });

  it('allows application code to import its domain and ports', async () => {
    const source =
      "import { y } from '../domain/email';\nimport type { Clock } from './ports/clock';\n";
    expect(await restrictedImports(APPLICATION_FILE, source)).toEqual([]);
  });
});

describe('identity never imports the categories module (dependency direction)', () => {
  it.each([
    [DOMAIN_FILE, "import { x } from '../../categories';"],
    [DOMAIN_FILE, "import { x } from '../../categories/domain/category';"],
    [APPLICATION_FILE, "import { seedDefaultCategories } from '../../categories';"],
    [APPLICATION_FILE, "import { x } from '../../categories/application/ensure-defaults';"],
    ['apps/api/src/identity/index.ts', "import { seedDefaultCategories } from '../categories';"],
    [
      'apps/api/src/identity/index.ts',
      "import { x } from './../categories/application/ensure-defaults';",
    ],
    [
      'apps/api/src/identity/infrastructure/db/probe.ts',
      "import { seedDefaultCategories } from '../../../categories';",
    ],
    [
      'apps/api/src/identity/infrastructure/http/probe.ts',
      "import { x } from '../../../categories/infrastructure/db/schema';",
    ],
  ])('rejects %s: %s', async (file, source) => {
    expect(await restrictedImports(file, `${source}\n`)).toEqual(['no-restricted-imports']);
  });

  it('keeps rejecting infrastructure and test imports where the categories pattern was added', async () => {
    expect(
      await restrictedImports(
        APPLICATION_FILE,
        "import { x } from '../infrastructure/db/schema';\n",
      ),
    ).toEqual(['no-restricted-imports']);
    expect(await restrictedImports(DOMAIN_FILE, "import { eq } from 'drizzle-orm';\n")).toEqual([
      'no-restricted-imports',
    ]);
    expect(
      await restrictedImports(
        'apps/api/src/identity/infrastructure/db/probe.ts',
        "import { x } from '../../../../test/fakes/mutable-clock';\n",
      ),
    ).toEqual(['no-restricted-imports']);
  });

  it('allows the composition root and other modules to import categories', async () => {
    const source = "import { seedDefaultCategories } from './categories';\n";
    expect(await restrictedImports('apps/api/src/server.ts', source)).toEqual([]);
    expect(
      await restrictedImports(
        'apps/api/src/accounts/application/probe.ts',
        "import { x } from '../../categories';\n",
      ),
    ).toEqual([]);
  });

  it('allows identity infrastructure to import its own files', async () => {
    const source = "import { x } from './schema';\nimport { y } from '../email/email-transport';\n";
    expect(
      await restrictedImports('apps/api/src/identity/infrastructure/db/probe.ts', source),
    ).toEqual([]);
  });
});

describe('identity, accounts and categories never import the movements module (dependency direction)', () => {
  it.each([
    [DOMAIN_FILE, "import { x } from '../../movements';"],
    [DOMAIN_FILE, "import { x } from '../../movements/domain/movement';"],
    [APPLICATION_FILE, "import { eraseUserMovements } from '../../movements';"],
    ['apps/api/src/identity/index.ts', "import { eraseUserMovements } from '../movements';"],
    [
      'apps/api/src/identity/infrastructure/db/probe.ts',
      "import { eraseUserMovements } from '../../../movements/infrastructure/db/erase-user-movements';",
    ],
    ['apps/api/src/accounts/domain/probe.ts', "import { x } from '../../movements';"],
    ['apps/api/src/accounts/application/probe.ts', "import { x } from '../../movements';"],
    ['apps/api/src/accounts/index.ts', "import { x } from '../movements';"],
    [
      'apps/api/src/accounts/infrastructure/db/probe.ts',
      "import { movements } from '../../../movements/infrastructure/db/schema';",
    ],
    ['apps/api/src/categories/domain/probe.ts', "import { x } from '../../movements';"],
    ['apps/api/src/categories/application/probe.ts', "import { x } from '../../movements';"],
    ['apps/api/src/categories/index.ts', "import { x } from '../movements';"],
    [
      'apps/api/src/categories/infrastructure/http/probe.ts',
      "import { x } from '../../../movements/infrastructure/db/schema';",
    ],
  ])('rejects %s: %s', async (file, source) => {
    expect(await restrictedImports(file, `${source}\n`)).toEqual(['no-restricted-imports']);
  });

  it('keeps the older restrictions where the movements pattern was added', async () => {
    for (const [file, source] of [
      [APPLICATION_FILE, "import { x } from '../infrastructure/db/schema';"],
      [DOMAIN_FILE, "import { eq } from 'drizzle-orm';"],
      [
        'apps/api/src/identity/infrastructure/db/probe.ts',
        "import { x } from '../../../../test/fakes/mutable-clock';",
      ],
      ['apps/api/src/accounts/domain/probe.ts', "import { eq } from 'drizzle-orm';"],
      [
        'apps/api/src/accounts/application/probe.ts',
        "import { x } from '../infrastructure/db/schema';",
      ],
      [
        'apps/api/src/accounts/infrastructure/db/probe.ts',
        "import { x } from '../../../../test/fakes/mutable-clock';",
      ],
      ['apps/api/src/categories/domain/probe.ts', "import pg from 'pg';"],
      [
        'apps/api/src/categories/application/probe.ts',
        "import { x } from '../infrastructure/db/schema';",
      ],
      [
        'apps/api/src/categories/infrastructure/db/probe.ts',
        "import { x } from '../../../../test/fakes/mutable-clock';",
      ],
    ] as const) {
      expect(await restrictedImports(file, `${source}\n`), file).toEqual(['no-restricted-imports']);
    }
  });

  it('allows the composition root and the movements module itself to import movements, and accounts to use its own movements adapter', async () => {
    expect(
      await restrictedImports(
        'apps/api/src/server.ts',
        "import { eraseUserMovements } from './movements';\n",
      ),
    ).toEqual([]);
    expect(
      await restrictedImports(
        'apps/api/src/movements/infrastructure/db/probe.ts',
        "import { x } from '../../domain/movement';\n",
      ),
    ).toEqual([]);
    expect(
      await restrictedImports(
        'apps/api/src/accounts/infrastructure/http/probe.ts',
        "import { NoMovementsAdapter } from '../movements/no-movements-adapter';\n",
      ),
    ).toEqual([]);
  });
});

describe('hexagonal import boundaries in the accounts module', () => {
  const ACCOUNTS_DOMAIN_FILE = 'apps/api/src/accounts/domain/probe.ts';
  const ACCOUNTS_APPLICATION_FILE = 'apps/api/src/accounts/application/probe.ts';

  it.each([
    "import { eq } from 'drizzle-orm';",
    "import pg from 'pg';",
    "import express from 'express';",
    "import { accounts } from '../infrastructure/db/schema';",
    "import { scopedTo } from '../../shared/access/infrastructure/drizzle-access-scope';",
  ])('rejects in accounts domain: %s', async (source) => {
    expect(await restrictedImports(ACCOUNTS_DOMAIN_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it.each([
    "import { accounts } from '../infrastructure/db/schema';",
    "import { x } from '../infrastructure/http/account-routes';",
    "import { x } from '../infrastructure/movements/no-movements-adapter';",
    "import { scopedTo } from '../../shared/access/infrastructure/drizzle-access-scope';",
  ])('rejects in accounts application: %s', async (source) => {
    expect(await restrictedImports(ACCOUNTS_APPLICATION_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it('allows accounts application code to import its domain, ports and the shared access port', async () => {
    const source =
      "import { x } from '../domain/account';\nimport type { AccountMovements } from './ports/account-movements';\nimport type { AccessScope } from '../../shared/access';\n";
    expect(await restrictedImports(ACCOUNTS_APPLICATION_FILE, source)).toEqual([]);
  });

  it('allows accounts domain code to import shared schemas and its own files', async () => {
    const source = "import { z } from 'zod';\nimport { y } from './account-name';\n";
    expect(await restrictedImports(ACCOUNTS_DOMAIN_FILE, source)).toEqual([]);
  });
});

describe('hexagonal import boundaries in the categories module', () => {
  const CATEGORIES_DOMAIN_FILE = 'apps/api/src/categories/domain/probe.ts';
  const CATEGORIES_APPLICATION_FILE = 'apps/api/src/categories/application/probe.ts';

  it.each([
    "import { eq } from 'drizzle-orm';",
    "import { pgTable } from 'drizzle-orm/pg-core';",
    "import pg from 'pg';",
    "import express from 'express';",
    "import { categories } from '../infrastructure/db/schema';",
    "import { scopedTo } from '../../shared/access/infrastructure/drizzle-access-scope';",
  ])('rejects in categories domain: %s', async (source) => {
    expect(await restrictedImports(CATEGORIES_DOMAIN_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it.each([
    "import { categories } from '../infrastructure/db/schema';",
    "import { x } from '../infrastructure/http/category-routes';",
    "import { x } from '../infrastructure/usage/no-usage-adapter';",
    "import { scopedTo } from '../../shared/access/infrastructure/drizzle-access-scope';",
  ])('rejects in categories application: %s', async (source) => {
    expect(await restrictedImports(CATEGORIES_APPLICATION_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it('allows categories application code to import its domain, ports and the shared access port', async () => {
    const source =
      "import { x } from '../domain/category';\nimport type { CategoryUsage } from './ports/category-usage';\nimport type { AccessScope } from '../../shared/access';\n";
    expect(await restrictedImports(CATEGORIES_APPLICATION_FILE, source)).toEqual([]);
  });

  it('allows categories domain code to import shared schemas and its own files', async () => {
    const source = "import { z } from 'zod';\nimport { y } from './naming';\n";
    expect(await restrictedImports(CATEGORIES_DOMAIN_FILE, source)).toEqual([]);
  });
});

describe('the categories persistence reaches identity only through its persistence file', () => {
  const IDENTITY_SCHEMA = 'identity/infrastructure/db/schema';

  /** Every module specifier the source imports, re-exports or dynamically imports. */
  function specifiers(source: string): string[] {
    const found = source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"]+)\1/g,
    );
    return [...found].map((match) => match[2] ?? '');
  }

  /** The specifiers that point into the identity module, with the file they appear in. */
  function identityReferences(files: Record<string, string>): { file: string; target: string }[] {
    return Object.entries(files).flatMap(([file, source]) =>
      specifiers(source)
        .filter((target) => /(^|\/)identity(\/|$)/.test(target))
        .map((target) => ({ file, target })),
    );
  }

  function categoriesSources(): Record<string, string> {
    const root = join(repoRoot, 'apps/api/src/categories');
    const files: Record<string, string> = {};
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts')) {
          files[relative(root, path).split(sep).join('/')] = readFileSync(path, 'utf8');
        }
      }
    };
    walk(root);
    return files;
  }

  it('imports users from the identity persistence file and nowhere else in identity', () => {
    const references = identityReferences(categoriesSources());
    expect(references).toEqual([
      { file: 'infrastructure/db/schema.ts', target: `../../../${IDENTITY_SCHEMA}` },
    ]);
  });

  it('takes the users table from that persistence file', () => {
    const schema = categoriesSources()['infrastructure/db/schema.ts'] ?? '';
    expect(schema).toContain(`import { users } from '../../../${IDENTITY_SCHEMA}';`);
  });

  it.each([
    "import { users } from '../../../identity';",
    "import { users } from '../../../identity/index';",
    "import { users } from '../../../identity/infrastructure/db/user-created-hook';",
    "export { users } from '../../../identity';",
    "const { users } = await import('../../../identity');",
  ])('the scanner flags an identity reference other than the schema file: %s', (source) => {
    const [reference] = identityReferences({ 'infrastructure/db/schema.ts': source });
    expect(reference).toBeDefined();
    expect(reference?.target).not.toBe(`../../../${IDENTITY_SCHEMA}`);
  });

  it('the scanner flags identity imports in other categories files', () => {
    const references = identityReferences({
      'application/probe.ts': "import { x } from '../../identity/domain/user';\n",
    });
    expect(references).toEqual([
      { file: 'application/probe.ts', target: '../../identity/domain/user' },
    ]);
  });
});

describe('hexagonal import boundaries in the exchange-rates module', () => {
  const RATES_DOMAIN_FILE = 'apps/api/src/exchange-rates/domain/probe.ts';
  const RATES_APPLICATION_FILE = 'apps/api/src/exchange-rates/application/probe.ts';

  it.each([
    "import { eq } from 'drizzle-orm';",
    "import pg from 'pg';",
    "import express from 'express';",
    "import { randomUUID } from 'node:crypto';",
    "import { rates } from '../infrastructure/db/schema';",
  ])('rejects in exchange-rates domain: %s', async (source) => {
    expect(await restrictedImports(RATES_DOMAIN_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it.each([
    "import { rates } from '../infrastructure/db/schema';",
    "import { x } from '../infrastructure/provider/dolarapi-rate-provider';",
  ])('rejects in exchange-rates application: %s', async (source) => {
    expect(await restrictedImports(RATES_APPLICATION_FILE, `${source}\n`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it('allows exchange-rates domain code to import shared schemas and sibling domain files', async () => {
    const source =
      "import { z } from 'zod';\nimport { AppError } from '@pesly/shared';\nimport { y } from './rate-quote';\n";
    expect(await restrictedImports(RATES_DOMAIN_FILE, source)).toEqual([]);
  });

  it('allows exchange-rates application code to import its own ports and domain files', async () => {
    const source =
      "import { x } from '../domain/rate-quote';\nimport type { RateProvider } from './ports/rate-provider';\nimport type { RateRepository } from './ports/rate-repository';\n";
    expect(await restrictedImports(RATES_APPLICATION_FILE, source)).toEqual([]);
  });
});
