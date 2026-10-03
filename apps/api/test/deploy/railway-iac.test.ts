import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResourceNode, ServiceNode, VariableValue } from 'railway/iac';
import { createRailwayContext, postgres, preserve, project, service } from 'railway/iac';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import program, { partial } from '../../../../.railway/railway';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** What the PRD requires, written here and never imported from the definition (FR-01, FR-03). */
const OWNED_RESOURCES = ['argent-api', 'argent-postgres', 'argent-web', 'argent-worker'];
const APP_SERVICES = ['argent-api', 'argent-web', 'argent-worker'];
const DATABASE = 'argent-postgres';
const SECRETS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'JWT_SECRET',
  'RESEND_API_KEY',
  // Encrypts the stored TOTP secrets (DISC-001-01c); losing it makes them unreadable.
  'TOTP_ENCRYPTION_KEY',
  // Optional Demo plan key of the worker's price job (DISC-001-07b); the worker starts without it.
  'COINGECKO_API_KEY',
];

const ALLOWED_LITERALS: Record<string, readonly string[]> = {
  'argent-api': [
    'API_ORIGIN',
    'BREACH_CHECKER',
    'EMAIL_FROM',
    'EMAIL_PROVIDER',
    'LOG_LEVEL',
    'NODE_ENV',
    'TRUST_PROXY',
    'WEB_BASE_URL',
    'WEB_ORIGIN',
  ],
  // With its references and secrets, exactly what parseWorkerEnv reads (FIX-003).
  'argent-worker': ['EMAIL_PROVIDER', 'LOG_LEVEL', 'NODE_ENV'],
  'argent-web': ['NODE_ENV'],
};

/** Variables that follow another resource's value, as production has them: `resource.OUTPUT`. */
const ALLOWED_REFERENCES: Record<string, Readonly<Record<string, string>>> = {
  'argent-api': { DATABASE_URL: `database.${DATABASE}.DATABASE_URL` },
  'argent-worker': {
    DATABASE_URL: `database.${DATABASE}.DATABASE_URL`,
    EMAIL_FROM: 'service.argent-api.EMAIL_FROM',
    WEB_BASE_URL: 'service.argent-api.WEB_BASE_URL',
  },
  'argent-web': { API_ORIGIN: 'service.argent-api.API_ORIGIN' },
};

const SERVICE_SECRETS: Record<string, readonly string[]> = {
  'argent-api': [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'JWT_SECRET',
    'RESEND_API_KEY',
    'TOTP_ENCRYPTION_KEY',
  ],
  'argent-worker': ['COINGECKO_API_KEY', 'RESEND_API_KEY'],
  'argent-web': [],
};

const BUILDS = {
  'argent-api': {
    buildCommand: 'pnpm --filter ./apps/api --fail-if-no-match build',
    watchPatterns: ['/apps/api/**', '/packages/shared/**', '/pnpm-lock.yaml'],
    startCommand: 'node --max-old-space-size=320 apps/api/dist/server.js',
  },
  'argent-worker': {
    buildCommand: 'pnpm --filter ./apps/api --fail-if-no-match build',
    watchPatterns: ['/apps/api/**', '/packages/shared/**', '/pnpm-lock.yaml'],
    startCommand: 'node --max-old-space-size=192 apps/api/dist/worker.js',
  },
  'argent-web': {
    buildCommand: 'pnpm --filter ./apps/web --fail-if-no-match build',
    watchPatterns: ['/apps/web/**', '/packages/shared/**', '/pnpm-lock.yaml'],
    startCommand:
      'node --max-old-space-size=320 apps/web/node_modules/next/dist/bin/next start apps/web',
  },
} as const;

const HEAP_CAPS_MB: Record<string, number> = {
  'argent-api': 320,
  'argent-worker': 192,
  'argent-web': 320,
};

/** Container limits (FIX-005): a runaway outside the V8 heap stops here, far below the plan maximum. */
const CONTAINER_LIMITS: Record<string, { cpu: number; memoryBytes: number }> = {
  'argent-api': { cpu: 2, memoryBytes: 2_000_000_000 },
  'argent-worker': { cpu: 1, memoryBytes: 512_000_000 },
  'argent-web': { cpu: 1, memoryBytes: 1_000_000_000 },
};

const MIB = 1024 * 1024;

const MIGRATION = 'node apps/api/dist/shared/db/migrate.js';

const DATABASE_REFERENCE = {
  type: 'reference',
  resource: `database.${DATABASE}`,
  output: 'DATABASE_URL',
} as const satisfies VariableValue;

/** `service.VARIABLE` for every secret a service declares with anything but `preserve()`. */
function literalSecrets(
  services: readonly ServiceNode[],
  secretNames: readonly string[],
): string[] {
  const found: string[] = [];
  for (const node of services) {
    for (const name of secretNames) {
      const value = node.variables?.[name];
      if (value && value.type !== 'preserve') found.push(`${node.name}.${name}`);
    }
  }
  return found;
}

/** Variables outside a service's allowed literals and references that are not preserved. */
function unprotectedVariables(
  services: readonly ServiceNode[],
  allowedLiterals: Record<string, readonly string[]>,
  allowedReferences: Record<string, Readonly<Record<string, string>>>,
): string[] {
  const found: string[] = [];
  for (const node of services) {
    const literals = allowedLiterals[node.name] ?? [];
    const references = allowedReferences[node.name] ?? {};
    for (const [name, value] of Object.entries(node.variables ?? {})) {
      if (literals.includes(name) || value.type === 'preserve') continue;
      const isAllowedReference =
        value.type === 'reference' && references[name] === `${value.resource}.${value.output}`;
      if (!isAllowedReference) found.push(`${node.name}.${name} is ${value.type}`);
    }
  }
  return found;
}

/** A missing or extra resource, by name. */
function resourceSetDifference(expected: readonly string[], found: readonly string[]): string[] {
  return [
    ...expected.filter((name) => !found.includes(name)).map((name) => `missing ${name}`),
    ...found.filter((name) => !expected.includes(name)).map((name) => `unexpected ${name}`),
  ];
}

/** A start command whose heap cap is missing or different, naming the service. */
function heapCapIssues(services: readonly ServiceNode[], caps: Record<string, number>): string[] {
  const issues: string[] = [];
  for (const [name, cap] of Object.entries(caps)) {
    const node = services.find((candidate) => candidate.name === name);
    const start = node?.deploy?.startCommand ?? '';
    const match = /--max-old-space-size=(\d+)/.exec(start);
    if (!match) {
      issues.push(`${name}: start command has no --max-old-space-size (expected ${cap})`);
    } else if (Number(match[1]) !== cap) {
      issues.push(`${name}: --max-old-space-size=${match[1] ?? ''}, expected ${cap}`);
    }
  }
  return issues;
}

/**
 * A build command that selects its package by name, or lets an unmatched filter pass: Railway builds
 * from `main`, so a name filter breaks when the package is renamed, and pnpm exits 0 on no match.
 */
function buildFilterIssues(services: readonly ServiceNode[]): string[] {
  const issues: string[] = [];
  for (const node of services) {
    const command = node.build?.buildCommand ?? '';
    const filters = [...command.matchAll(/--filter[ =](\S+)/g)].map((match) => match[1] ?? '');
    if (filters.length === 0 || filters.some((filter) => !filter.startsWith('./'))) {
      issues.push(`${node.name}: build filter is not a ./ path (${command})`);
    }
    if (!command.includes('--fail-if-no-match')) {
      issues.push(`${node.name}: missing --fail-if-no-match (${command})`);
    }
  }
  return issues;
}

/** A container memory limit that is missing or below twice the V8 heap cap, naming the service. */
function containerMemoryIssues(
  services: readonly ServiceNode[],
  heapCapsMb: Record<string, number>,
): string[] {
  const issues: string[] = [];
  for (const [name, heapMb] of Object.entries(heapCapsMb)) {
    const minimum = 2 * heapMb * MIB;
    const node = services.find((candidate) => candidate.name === name);
    const limit = node?.deploy?.limitOverride?.containers?.memoryBytes;
    if (limit == null) {
      issues.push(`${name}: no container memory limit (expected at least ${minimum} bytes)`);
    } else if (limit < minimum) {
      issues.push(`${name}: container memory limit ${limit} bytes, expected at least ${minimum}`);
    }
  }
  return issues;
}

function isService(node: ResourceNode): node is ServiceNode {
  return node.type === 'service';
}

function readDevDependency(packageJson: string, name: string): string | undefined {
  const parsed = JSON.parse(readFileSync(path.join(repoRoot, packageJson), 'utf8')) as {
    devDependencies?: Record<string, string>;
  };
  return parsed.devDependencies?.[name];
}

/** Every file under `dir` whose name is in `names`, skipping installed and generated trees. */
function findFiles(dir: string, names: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist', 'coverage'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(full, names));
    else if (names.includes(entry.name)) found.push(path.relative(repoRoot, full));
  }
  return found;
}

const RAILWAY_TOKENS = ['RAILWAY_TOKEN', 'RAILWAY_API_TOKEN'];
const savedTokens = new Map<string, string | undefined>();

let resources: ResourceNode[] = [];
let services: ServiceNode[] = [];

function serviceNamed(name: string): ServiceNode {
  const node = services.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`service ${name} is not defined`);
  return node;
}

beforeAll(async () => {
  // The definition is evaluated in-process, offline: no Railway credential may be needed.
  for (const name of RAILWAY_TOKENS) {
    savedTokens.set(name, process.env[name]);
    Reflect.deleteProperty(process.env, name);
  }
  const definition = await program(createRailwayContext({ environment: 'production' }), project);
  resources = (definition.resources ?? []).flat();
  services = resources.filter(isService);
});

afterAll(() => {
  for (const [name, value] of savedTokens) {
    if (value !== undefined) process.env[name] = value;
  }
});

describe('Railway Infrastructure as Code definition', () => {
  it('owns exactly the four Pesly resources and declares the pesly partial', () => {
    const found = resources.map((node) => node.name).sort();
    expect(
      resourceSetDifference(OWNED_RESOURCES, found),
      `expected ${OWNED_RESOURCES.join(', ')}; found ${found.join(', ')}`,
    ).toEqual([]);
    expect(partial).toBe('pesly');
    expect(services.map((node) => node.name).sort()).toEqual(APP_SERVICES);

    const database = resources.find((node) => node.name === DATABASE);
    expect(database?.type).toBe('database');
  });

  it('deploys every application service from the main branch of the repository', () => {
    for (const name of APP_SERVICES) {
      expect(serviceNamed(name).source, name).toMatchObject({
        type: 'github',
        repo: 'MussiDev/pesly',
        branch: 'main',
      });
    }
    expect(serviceNamed('argent-api').source?.checkSuites).toBe(true);
  });

  it('caps every application container, at least twice its V8 heap, and leaves the database unset', () => {
    for (const [name, containers] of Object.entries(CONTAINER_LIMITS)) {
      expect(serviceNamed(name).deploy?.limitOverride, name).toEqual({ containers });
    }
    expect(containerMemoryIssues(services, HEAP_CAPS_MB)).toEqual([]);
    const database = resources.find((node) => node.name === DATABASE);
    expect(JSON.stringify(database)).not.toContain('limitOverride');
  });

  it('builds each application service with RAILPACK and its build command, watching its paths', () => {
    for (const [name, expected] of Object.entries(BUILDS)) {
      expect(serviceNamed(name).build, name).toEqual({
        builder: 'RAILPACK',
        buildCommand: expected.buildCommand,
        watchPatterns: expected.watchPatterns,
      });
    }
  });

  it('selects every build package by path and fails the build when the filter matches nothing', () => {
    expect(buildFilterIssues(services)).toEqual([]);
  });

  it('each application service keeps the ON_FAILURE default and restarts at most 5 times', () => {
    for (const name of APP_SERVICES) {
      const deploy = serviceNamed(name).deploy;
      // Unset means Railway's default policy, ON_FAILURE; any declared type would override it.
      expect(deploy?.restartPolicyType, name).toBeUndefined();
      expect(deploy?.restartPolicyMaxRetries, name).toBe(5);
    }
  });

  it('start commands cap the heap at 320 MB (API, web) and 192 MB (worker)', () => {
    expect(heapCapIssues(services, HEAP_CAPS_MB)).toEqual([]);
    for (const [name, expected] of Object.entries(BUILDS)) {
      const start = serviceNamed(name).deploy?.startCommand ?? '';
      expect(start, name).toBe(expected.startCommand);
      expect(start, name).toMatch(/^node\s/);
      expect(serviceNamed(name).build?.buildCommand ?? '', name).not.toContain('max-old-space');
    }
  });

  it('starts Next.js with node directly, with no pnpm parent process and no NODE_OPTIONS', () => {
    const start = serviceNamed('argent-web').deploy?.startCommand ?? '';
    expect(start).toBe(BUILDS['argent-web'].startCommand);
    expect(start).not.toMatch(/\bpnpm\b|\bnpm\b|NODE_OPTIONS/);
  });

  it('runs the migration as the pre-deploy command of the API only', () => {
    expect(serviceNamed('argent-api').deploy?.preDeployCommand).toEqual([MIGRATION]);
    expect(serviceNamed('argent-worker').deploy?.preDeployCommand).toBeUndefined();
    expect(serviceNamed('argent-web').deploy?.preDeployCommand).toBeUndefined();
  });

  it('declares each service non-secret variables as literals or references, and nothing else beyond its secrets', () => {
    for (const name of APP_SERVICES) {
      const variables = serviceNamed(name).variables ?? {};
      const literals = ALLOWED_LITERALS[name] ?? [];
      const expectedNames = [
        ...literals,
        ...(SERVICE_SECRETS[name] ?? []),
        ...Object.keys(ALLOWED_REFERENCES[name] ?? {}),
      ].sort();
      expect(Object.keys(variables).sort(), name).toEqual(expectedNames);

      for (const literal of literals) {
        const value = variables[literal];
        expect(value?.type, `${name}.${literal}`).toBe('literal');
        if (value?.type === 'literal') expect(value.value, `${name}.${literal}`).toBeTruthy();
      }
    }
  });

  it('gives the services one production configuration: shared values follow the API, https origins', () => {
    const literal = (name: string, variable: string): string | null | undefined => {
      const value = serviceNamed(name).variables?.[variable];
      return value?.type === 'literal' ? value.value : undefined;
    };
    for (const name of APP_SERVICES) expect(literal(name, 'NODE_ENV'), name).toBe('production');
    for (const variable of ['LOG_LEVEL', 'EMAIL_PROVIDER']) {
      expect(literal('argent-worker', variable), variable).toBe(literal('argent-api', variable));
    }
    expect(unprotectedVariables(services, ALLOWED_LITERALS, ALLOWED_REFERENCES)).toEqual([]);
    for (const variable of ['WEB_BASE_URL', 'WEB_ORIGIN', 'API_ORIGIN']) {
      expect(literal('argent-api', variable) ?? '', variable).toMatch(/^https:\/\//);
    }
  });

  it('points DATABASE_URL of the API and the worker at the argent-postgres reference', () => {
    for (const name of ['argent-api', 'argent-worker']) {
      expect(serviceNamed(name).variables?.DATABASE_URL, name).toEqual(DATABASE_REFERENCE);
    }
  });

  it('every secret is preserved, and every variable outside the literal set is preserved or a reference', () => {
    expect(literalSecrets(services, SECRETS)).toEqual([]);
    expect(unprotectedVariables(services, ALLOWED_LITERALS, ALLOWED_REFERENCES)).toEqual([]);
    for (const [name, secrets] of Object.entries(SERVICE_SECRETS)) {
      for (const secret of secrets) {
        expect(serviceNamed(name).variables?.[secret], `${name}.${secret}`).toEqual(preserve());
      }
    }
  });

  it('gives the CoinGecko key to the worker only, through preserve(), and declares no price provider literal', () => {
    expect(serviceNamed('argent-worker').variables?.COINGECKO_API_KEY).toEqual(preserve());
    for (const service of services) {
      const names = Object.keys(service.variables ?? {});
      expect(names, service.name).not.toContain('PRICE_PROVIDER');
      expect(names, service.name).not.toContain('COINGECKO_BASE_URL');
      if (service.name !== 'argent-worker')
        expect(names, service.name).not.toContain('COINGECKO_API_KEY');
    }
  });

  it('pins the same exact railway SDK version in the root and API package.json', () => {
    const root = readDevDependency('package.json', 'railway');
    const api = readDevDependency('apps/api/package.json', 'railway');
    expect(root).toMatch(/^\d+\.\d+\.\d+$/);
    expect(api).toBe(root);
  });

  it('leaves no railway.json or railway.worker.json under apps/', () => {
    expect(findFiles(path.join(repoRoot, 'apps'), ['railway.json', 'railway.worker.json'])).toEqual(
      [],
    );
  });
});

describe('Railway definition checks (sad paths)', () => {
  it('build filter error: a package-name filter, or one without --fail-if-no-match, names the service', () => {
    const nodes = [
      service('argent-api', { build: { buildCommand: 'pnpm --filter @pesly/api build' } }),
      service('argent-web', { build: { buildCommand: 'pnpm --filter ./apps/web build' } }),
      service('argent-worker', {
        build: {
          buildCommand: 'pnpm --filter ./apps/api --filter @pesly/web --fail-if-no-match build',
        },
      }),
    ];
    expect(buildFilterIssues(nodes)).toEqual([
      'argent-api: build filter is not a ./ path (pnpm --filter @pesly/api build)',
      'argent-api: missing --fail-if-no-match (pnpm --filter @pesly/api build)',
      'argent-web: missing --fail-if-no-match (pnpm --filter ./apps/web build)',
      'argent-worker: build filter is not a ./ path (pnpm --filter ./apps/api --filter @pesly/web --fail-if-no-match build)',
    ]);
  });

  it('container limit error: a memory limit below twice the heap, or none, names the service and the minimum', () => {
    const nodes = [
      service('argent-api', {
        deploy: { limitOverride: { containers: { cpu: 2, memoryBytes: 2_000_000_000 } } },
      }),
      service('argent-worker', {
        deploy: { limitOverride: { containers: { cpu: 1, memoryBytes: 256_000_000 } } },
      }),
      service('argent-web'),
    ];
    expect(containerMemoryIssues(nodes, HEAP_CAPS_MB)).toEqual([
      `argent-worker: container memory limit 256000000 bytes, expected at least ${String(2 * 192 * MIB)}`,
      `argent-web: no container memory limit (expected at least ${String(2 * 320 * MIB)} bytes)`,
    ]);
  });

  it('secret error: a secret given a literal value is reported as service.VARIABLE', () => {
    const leaky = service('argent-api', {
      env: { JWT_SECRET: 'not-a-real-secret', RESEND_API_KEY: preserve() },
    });
    const worker = service('argent-worker', { env: { RESEND_API_KEY: 're_fake' } });
    expect(literalSecrets([leaky, worker], SECRETS)).toEqual([
      'argent-api.JWT_SECRET',
      'argent-worker.RESEND_API_KEY',
    ]);
  });

  it('secret error: a secret turned literal and dropped from the secret list is still reported', () => {
    const db = postgres(DATABASE);
    const leaky = service('argent-worker', {
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: db.env.DATABASE_URL,
        SOME_NEW_SECRET: 'not-a-real-secret',
        OTHER_DATABASE_URL: db.env.DATABASE_URL,
      },
    });
    expect(literalSecrets([leaky], SECRETS)).toEqual([]);
    expect(unprotectedVariables([leaky], ALLOWED_LITERALS, ALLOWED_REFERENCES)).toEqual([
      'argent-worker.SOME_NEW_SECRET is literal',
      'argent-worker.OTHER_DATABASE_URL is reference',
    ]);
  });

  it('secret error: a reference that hands the worker another service secret is reported', () => {
    const api = service('argent-api', { env: { JWT_SECRET: preserve() } });
    const worker = service('argent-worker', {
      env: { JWT_SECRET: api.env.JWT_SECRET, EMAIL_FROM: api.env.JWT_SECRET },
    });
    expect(unprotectedVariables([worker], ALLOWED_LITERALS, ALLOWED_REFERENCES)).toEqual([
      'argent-worker.JWT_SECRET is reference',
      'argent-worker.EMAIL_FROM is reference',
    ]);
  });

  it('service set error: a missing, renamed or added service is reported by name', () => {
    expect(
      resourceSetDifference(OWNED_RESOURCES, [
        'argent-api',
        'argent-postgres',
        'argent-front',
        'argent-worker',
        'nortear',
      ]),
    ).toEqual(['missing argent-web', 'unexpected argent-front', 'unexpected nortear']);
  });

  it('heap limit error: a start command without its cap, or with a different one, names the service and the cap', () => {
    const nodes = [
      service('argent-api', { start: 'node apps/api/dist/server.js' }),
      service('argent-worker', { start: 'node --max-old-space-size=320 apps/api/dist/worker.js' }),
      service('argent-web', { start: BUILDS['argent-web'].startCommand }),
    ];
    expect(heapCapIssues(nodes, HEAP_CAPS_MB)).toEqual([
      'argent-api: start command has no --max-old-space-size (expected 320)',
      'argent-worker: --max-old-space-size=320, expected 192',
    ]);
    expect(heapCapIssues([], { 'argent-api': 320 })).toEqual([
      'argent-api: start command has no --max-old-space-size (expected 320)',
    ]);
  });
});
