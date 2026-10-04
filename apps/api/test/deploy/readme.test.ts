import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The README describes the product, so it must not promise a command, script or folder the
 * repository does not have (spec 03e, Block 10). It reads plain text only.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

function packageAt(directory: string): PackageJson {
  return JSON.parse(readFileSync(join(repoRoot, directory, 'package.json'), 'utf8')) as PackageJson;
}

const WORKSPACES = [
  packageAt('.'),
  packageAt('apps/api'),
  packageAt('apps/web'),
  packageAt('packages/shared'),
];

/** `pnpm` subcommands that are not scripts of this repository. */
const PNPM_BUILT_INS = new Set(['install', 'exec', 'add', 'dlx']);

/** Every line of the README that runs pnpm, without the prompt and any trailing comment. */
function pnpmCommands(): string[] {
  return readme
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('pnpm '))
    .map((line) => line.replace(/\s+#.*$/, '').trim());
}

describe('README commands and paths', () => {
  it('names only pnpm scripts that exist in the root or in a workspace', () => {
    const commands = pnpmCommands();
    expect(commands.length).toBeGreaterThan(0);

    for (const command of commands) {
      const words = command.split(/\s+/).slice(1);
      const first = words[0] ?? '';
      if (first === '--filter') {
        const target = WORKSPACES.find((workspace) => workspace.name === words[1]);
        expect(target, `${command}: no workspace is named ${words[1]}`).toBeDefined();
        const script = words[2] ?? '';
        expect(target?.scripts?.[script], `${command}: no script ${script}`).toBeDefined();
      } else if (!PNPM_BUILT_INS.has(first)) {
        expect(
          WORKSPACES[0]?.scripts?.[first],
          `${command}: no root script ${first}`,
        ).toBeDefined();
      }
    }
  });

  it('shows only apps, packages and docs paths that exist in the repository', () => {
    const paths = new Set(readme.match(/\b(?:apps|packages|docs)\/[\w./*-]*[\w/*]/g) ?? []);
    expect(paths.size).toBeGreaterThan(0);

    for (const path of paths) {
      // A pattern such as `apps/api/drizzle/0000_*.sql` is a family of files, not one path.
      if (path.includes('*') || path.includes('...')) continue;
      expect(existsSync(join(repoRoot, path)), `${path} does not exist`).toBe(true);
    }
  });

  it('does not mention dev.sh, which the repository does not have', () => {
    expect(readme).not.toContain('dev.sh');
    expect(existsSync(join(repoRoot, 'dev.sh'))).toBe(false);
  });

  it('has a Status section that tells what is built from what is planned', () => {
    expect(readme).toMatch(/^#{1,3} .*Status/m);
    const status = readme.split(/^#{1,3} .*Status/m)[1]?.split(/^#{1,2} /m)[0] ?? '';
    expect(status).toMatch(/Built/i);
    expect(status).toMatch(/Planned/i);
  });

  it('names the real repository and no secret or private address', () => {
    expect(readme).toContain('https://github.com/MussiDev/pesly.git');
    expect(readme).not.toMatch(/password\s*=|secret\s*=|api[_-]?key\s*=/i);
    expect(readme).not.toMatch(/postgres:\/\/\w+:\w+@/);
  });
});
