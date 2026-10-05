import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASSET_CATALOG } from '../src/lib/logos/asset-catalog';
import { MERCHANT_CATALOG } from '../src/lib/logos/merchant-catalog';
import { tokenize } from '../src/lib/logos/normalize';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const logosDir = join(webRoot, 'public/logos');
const MAX_BYTES = 10 * 1024;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** What a logo file must never carry: anything that runs, links out or embeds markup. */
function violations(content: string, bytes: number): string[] {
  const found: string[] = [];
  if (bytes > MAX_BYTES) found.push(`over ${MAX_BYTES} bytes (${bytes})`);
  if (!/^<svg[\s>]/.test(content.trim())) found.push('does not start with <svg');
  if (/<script/i.test(content)) found.push('script element');
  if (/\son[a-z]+\s*=/i.test(content)) found.push('event attribute');
  if (/<foreignObject/i.test(content)) found.push('foreignObject');
  if (/<(?:iframe|object|embed|image|use)\b/i.test(content)) found.push('embedding element');
  if (/(?:xlink:)?href\s*=/i.test(content)) found.push('href reference');
  if (/@import|url\(\s*['"]?https?:/i.test(content)) found.push('external stylesheet or url()');
  // The one URL an SVG may hold is its own namespace declaration.
  if (/https?:\/\//i.test(content.replaceAll(`xmlns="${SVG_NAMESPACE}"`, ''))) {
    found.push('external URL');
  }
  return found;
}

const files = readdirSync(logosDir).filter((name) => name.endsWith('.svg'));

function logoPath(url: string): string {
  return join(logosDir, url.replace(/^\/logos\//, ''));
}

describe('merchant catalog (AC-17)', () => {
  it('has at most 40 entries, each with a name, a keyword and an existing logo file', () => {
    expect(MERCHANT_CATALOG.length).toBeGreaterThan(0);
    expect(MERCHANT_CATALOG.length).toBeLessThanOrEqual(40);
    for (const entry of MERCHANT_CATALOG) {
      expect(entry.name.trim(), entry.id).not.toBe('');
      expect(entry.keywords.length, entry.id).toBeGreaterThan(0);
      for (const keyword of entry.keywords) {
        expect(tokenize(keyword).length, `${entry.id}: "${keyword}"`).toBeGreaterThan(0);
      }
      expect(entry.logo, entry.id).toMatch(/^\/logos\/[a-z0-9-]+\.svg$/);
      expect(existsSync(logoPath(entry.logo)), `${entry.id} → ${entry.logo}`).toBe(true);
    }
  });

  it('has unique ids and no keyword shared by two entries', () => {
    const ids = MERCHANT_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const entry of MERCHANT_CATALOG) {
      for (const keyword of entry.keywords) {
        const key = tokenize(keyword).join(' ');
        const owner = seen.get(key);
        if (owner !== undefined && owner !== entry.id)
          clashes.push(`"${key}": ${owner}, ${entry.id}`);
        seen.set(key, entry.id);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe('asset catalog (AC-17)', () => {
  it('has at most 40 entries, each with a ticker, a name and an existing logo file', () => {
    expect(ASSET_CATALOG.length).toBeGreaterThan(0);
    expect(ASSET_CATALOG.length).toBeLessThanOrEqual(40);
    for (const entry of ASSET_CATALOG) {
      expect(entry.ticker, entry.name).toMatch(/^[A-Z0-9.]{1,12}$/);
      expect(entry.name.trim(), entry.ticker).not.toBe('');
      expect(entry.logo, entry.ticker).toMatch(/^\/logos\/[a-z0-9-]+\.svg$/);
      expect(existsSync(logoPath(entry.logo)), `${entry.ticker} → ${entry.logo}`).toBe(true);
    }
  });
});

describe('logo files (NFR-06, AC-26)', () => {
  it('finds the bundled files', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('keeps every file small and free of active or external content', () => {
    const problems = files.flatMap((name) => {
      const path = join(logosDir, name);
      return violations(readFileSync(path, 'utf8'), statSync(path).size).map(
        (problem) => `${name}: ${problem}`,
      );
    });
    expect(problems).toEqual([]);
  });

  it('error: a file over 10 KB, with a script, an event attribute, a foreignObject or an external URL is reported', () => {
    const svg = (inner: string) =>
      `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 24 24">${inner}</svg>`;

    expect(violations(svg('<path d="M0 0"/>'), 100)).toEqual([]);
    expect(violations(svg('<path d="M0 0"/>'), MAX_BYTES + 1)).toHaveLength(1);
    expect(violations(svg('<script>alert(1)</script>'), 100)).toContain('script element');
    expect(violations(svg('<path onload="x()" d="M0 0"/>'), 100)).toContain('event attribute');
    expect(violations(svg('<foreignObject></foreignObject>'), 100)).toContain('foreignObject');
    expect(violations(svg('<image href="a.png"/>'), 100)).toContain('embedding element');
    expect(
      violations(svg('<path d="M0 0" style="fill:url(https://evil.test/x)"/>'), 100),
    ).toContain('external stylesheet or url()');
    expect(violations(svg('<a xlink:href="https://evil.test">x</a>'), 100)).toContain(
      'href reference',
    );
  });

  it('error: every logo path used by a catalog points inside /logos/ and no entry uses a URL', () => {
    const paths = [...MERCHANT_CATALOG, ...ASSET_CATALOG].map((entry) => entry.logo);
    for (const path of paths) {
      expect(path.startsWith('/logos/'), path).toBe(true);
      expect(path).not.toMatch(/^[a-z]+:|\/\/|\.\./i);
    }
  });

  it('records the source and license of every file in NOTICE.md', () => {
    const notice = readFileSync(join(logosDir, 'NOTICE.md'), 'utf8');
    expect(notice).toMatch(/CC0/);
    expect(notice).toMatch(/simple-icons/i);
    const unrecorded = files.filter((name) => !notice.includes(`\`${name}\``));
    expect(unrecorded).toEqual([]);
  });
});
