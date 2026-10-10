import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const INFRASTRUCTURE_IMPORTS = {
  group: ['**/infrastructure', '**/infrastructure/**'],
  message: 'Only infrastructure may depend on infrastructure (hexagonal boundary).',
};

// Production code never depends on tests, fixtures or fakes (e.g. test-only routes).
const TEST_IMPORTS = {
  group: ['**/test', '**/test/**'],
  message: 'Production code must not import test code.',
};

// Frameworks, drivers, SDKs and Node built-ins are I/O concerns: domain code stays pure.
const IO_IMPORTS = {
  group: [
    'drizzle-orm',
    'drizzle-orm/*',
    'pg',
    'pg/*',
    'express',
    'express/*',
    'jose',
    'jose/*',
    '@node-rs/argon2',
    'resend',
    'resend/*',
    'node:*',
  ],
  message: 'Domain code must stay free of frameworks, drivers, SDKs and Node built-ins.',
};

// Identity declares a port and the composition root wires categories in; identity never knows it.
const CATEGORIES_IMPORTS = {
  group: ['**/categories', '**/categories/**'],
  message:
    'Identity must not import the categories module; the composition root registers a hook instead.',
};

// Identity, accounts, categories, credit-cards and recurring declare ports; only the composition root wires movements in.
// A regex, not a glob: accounts has its own `infrastructure/movements` adapter folder, and a glob
// that matches the folder name would also match everything inside it. This matches only the
// movements module barrel and its layers.
const MOVEMENTS_IMPORTS = {
  regex: '^(\\.\\./)+movements(/(domain|application|infrastructure|index)(/.*)?)?$',
  message:
    'Identity, accounts, categories, credit-cards and recurring must not import the movements module; the composition root wires it in.',
};

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
      'apps/api/drizzle/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs', 'apps/*/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  // The service worker runs in a worker scope, so it is excluded from the app tsconfig and has its own.
  {
    files: ['apps/web/src/app/sw.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['apps/web/tsconfig.sw.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Flat config replaces rule options per file, so the more specific blocks below repeat TEST_IMPORTS.
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [TEST_IMPORTS] }],
    },
  },
  {
    files: ['apps/api/src/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [INFRASTRUCTURE_IMPORTS, IO_IMPORTS, TEST_IMPORTS] },
      ],
    },
  },
  {
    files: ['apps/api/src/*/application/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [INFRASTRUCTURE_IMPORTS, TEST_IMPORTS] }],
    },
  },
  // Identity: the three blocks above repeated with CATEGORIES_IMPORTS and MOVEMENTS_IMPORTS added
  // (later blocks win).
  {
    files: ['apps/api/src/identity/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [TEST_IMPORTS, CATEGORIES_IMPORTS, MOVEMENTS_IMPORTS] },
      ],
    },
  },
  {
    files: ['apps/api/src/identity/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            INFRASTRUCTURE_IMPORTS,
            IO_IMPORTS,
            TEST_IMPORTS,
            CATEGORIES_IMPORTS,
            MOVEMENTS_IMPORTS,
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/identity/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [INFRASTRUCTURE_IMPORTS, TEST_IMPORTS, CATEGORIES_IMPORTS, MOVEMENTS_IMPORTS] },
      ],
    },
  },
  // Accounts and categories: the generic blocks repeated with MOVEMENTS_IMPORTS added, because a
  // files-scoped block replaces the options of the generic ones.
  {
    files: ['apps/api/src/accounts/**/*.ts', 'apps/api/src/categories/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [TEST_IMPORTS, MOVEMENTS_IMPORTS] }],
    },
  },
  {
    files: ['apps/api/src/accounts/domain/**/*.ts', 'apps/api/src/categories/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [INFRASTRUCTURE_IMPORTS, IO_IMPORTS, TEST_IMPORTS, MOVEMENTS_IMPORTS] },
      ],
    },
  },
  {
    files: [
      'apps/api/src/accounts/application/**/*.ts',
      'apps/api/src/categories/application/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [INFRASTRUCTURE_IMPORTS, TEST_IMPORTS, MOVEMENTS_IMPORTS] },
      ],
    },
  },
  // Credit cards declares ports for expenses and purchases that the movements adapters implement;
  // movements imports credit-cards types, never the reverse. The generic blocks are repeated with
  // MOVEMENTS_IMPORTS added.
  {
    files: ['apps/api/src/credit-cards/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [TEST_IMPORTS, MOVEMENTS_IMPORTS] }],
    },
  },
  {
    files: ['apps/api/src/credit-cards/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [INFRASTRUCTURE_IMPORTS, IO_IMPORTS, TEST_IMPORTS, MOVEMENTS_IMPORTS] },
      ],
    },
  },
  {
    files: ['apps/api/src/credit-cards/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [INFRASTRUCTURE_IMPORTS, TEST_IMPORTS, MOVEMENTS_IMPORTS] },
      ],
    },
  },

  // Recurring declares the expense port that a movements adapter implements; recurring never
  // imports movements.
  {
    files: ['apps/api/src/recurring/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [TEST_IMPORTS, MOVEMENTS_IMPORTS] }],
    },
  },
  {
    files: ['apps/api/src/recurring/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [INFRASTRUCTURE_IMPORTS, IO_IMPORTS, TEST_IMPORTS, MOVEMENTS_IMPORTS] },
      ],
    },
  },
  {
    files: ['apps/api/src/recurring/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [INFRASTRUCTURE_IMPORTS, TEST_IMPORTS, MOVEMENTS_IMPORTS] },
      ],
    },
  },
);
