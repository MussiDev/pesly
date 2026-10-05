import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const css = readFileSync(join(webRoot, 'src/app/globals.css'), 'utf8').replace(/\r\n/g, '\n');

type Oklch = { l: number; c: number; h: number };

/** The declarations of the first top-level block opened by `selector`. */
function blockOf(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return new Map();
  const end = css.indexOf('\n}', start);
  const body = css.slice(start, end);
  const declarations = new Map<string, string>();
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    declarations.set(match[1] as string, (match[2] as string).trim());
  }
  return declarations;
}

const light = blockOf(':root');
const dark = blockOf('.dark');

function parseOklch(value: string | undefined): Oklch | undefined {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value ?? '');
  if (!match) return undefined;
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

/** Relative luminance (WCAG 2.x) of an opaque OKLCH colour; out-of-gamut channels are clipped. */
function luminance({ l, c, h }: Oklch): number {
  const hue = (h * Math.PI) / 180;
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (x: number) => Math.min(1, Math.max(0, x));
  const r = clip(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
  const g = clip(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
  const bl = clip(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(foreground: Oklch, background: Oklch): number {
  const x = luminance(foreground);
  const y = luminance(background);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function colour(theme: Map<string, string>, token: string): Oklch {
  const parsed = parseOklch(theme.get(token));
  if (!parsed) throw new Error(`--${token} is missing or not an opaque oklch() value`);
  return parsed;
}

const CHART_TOKENS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'];

const SEMANTIC_TOKENS = [
  'background',
  'foreground',
  'surface',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'muted',
  'muted-foreground',
  'secondary',
  'secondary-foreground',
  'accent',
  'accent-foreground',
  'border',
  'input',
  'ring',
  'primary',
  'primary-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'destructive',
  'destructive-foreground',
  'info',
  'info-foreground',
  'income',
  'expense',
  'hero-from',
  'hero-to',
  'hero-foreground',
  'hero-muted',
  'logo-surface',
  ...CHART_TOKENS,
];

const CATEGORY_TOKENS = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'violet',
  'pink',
  'slate',
].map((name) => `category-${name}`);

/** Text on its own surface: 4.5:1. */
const TEXT_PAIRS: [string, string][] = [
  ['foreground', 'background'],
  ['foreground', 'surface'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'surface'],
  ['muted-foreground', 'muted'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['primary-foreground', 'primary'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['destructive-foreground', 'destructive'],
  ['info-foreground', 'info'],
  ['primary', 'background'],
  ['primary', 'card'],
  ['success', 'background'],
  ['success', 'card'],
  ['warning', 'background'],
  ['warning', 'card'],
  ['destructive', 'background'],
  ['destructive', 'card'],
  ['info', 'background'],
  ['info', 'card'],
  ['income', 'background'],
  ['income', 'card'],
  ['expense', 'background'],
  ['expense', 'card'],
  // The navy balance card: both ends of its gradient carry its text.
  ['hero-foreground', 'hero-from'],
  ['hero-foreground', 'hero-to'],
  ['hero-muted', 'hero-from'],
  ['hero-muted', 'hero-to'],
];

/** Control borders, focus rings, category icons: 3:1 (WCAG 1.4.11). */
const NON_TEXT_PAIRS: [string, string][] = [
  ['input', 'background'],
  ['input', 'card'],
  ['ring', 'background'],
  ['ring', 'card'],
  // Donut segments sit on the card and on the canvas.
  ...CHART_TOKENS.flatMap((token): [string, string][] => [
    [token, 'background'],
    [token, 'card'],
  ]),
  ...CATEGORY_TOKENS.flatMap((token): [string, string][] => [
    [token, 'background'],
    [token, 'card'],
  ]),
];

describe('design tokens (AC-01)', () => {
  it.each(SEMANTIC_TOKENS)('defines --%s in light and in dark', (token) => {
    expect(light.get(token), `light --${token}`).toBeDefined();
    expect(dark.get(token), `dark --${token}`).toBeDefined();
  });

  it.each(CATEGORY_TOKENS)('keeps --%s in light and in dark', (token) => {
    expect(light.get(token), `light --${token}`).toBeDefined();
    expect(dark.get(token), `dark --${token}`).toBeDefined();
  });

  it.each(SEMANTIC_TOKENS)('maps --%s to a Tailwind colour utility', (token) => {
    expect(css).toContain(`--color-${token}: var(--${token});`);
  });

  it('writes every colour as an opaque oklch() value', () => {
    for (const [name, theme] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      for (const token of [...SEMANTIC_TOKENS, ...CATEGORY_TOKENS]) {
        expect(parseOklch(theme.get(token)), `${name} --${token}`).toBeDefined();
      }
    }
  });

  it('anchors the palette: navy at hue 265, cool neutrals at hue 250-290 with low chroma', () => {
    for (const theme of [light, dark]) {
      expect(colour(theme, 'primary').h).toBe(265);
      expect(colour(theme, 'income').h).toBe(160);
      for (const token of ['background', 'surface', 'foreground', 'muted', 'secondary']) {
        const { c, h } = colour(theme, token);
        expect(c, token).toBeLessThanOrEqual(0.015);
        if (c > 0) {
          expect(h, token).toBeGreaterThanOrEqual(250);
          expect(h, token).toBeLessThanOrEqual(290);
        }
      }
    }
  });

  it('defines the type, radius, elevation, motion and font tokens', () => {
    for (const step of ['display', 'title', 'heading', 'body', 'small', 'caption']) {
      expect(css, `--text-${step}`).toMatch(new RegExp(`--text-${step}:`));
      expect(css, `--text-${step} line height`).toMatch(new RegExp(`--text-${step}--line-height:`));
    }
    expect(css).toMatch(/--font-sans:\s*var\(--font-sans\)|--font-sans:/);
    expect(css).toMatch(/--radius:\s*1rem;/);
    expect(css).toMatch(/--radius-card:\s*1\.5rem;/);
    expect(css).toMatch(/--radius-pill:\s*9999px;/);
    expect(css).toMatch(/--spacing-circle-action:\s*3\.25rem;/);
    expect(css).toMatch(/--elevation-1:/);
    expect(css).toMatch(/--elevation-2:/);
    expect(css).toMatch(/--duration-base:/);
    expect(css).toMatch(/--ease-standard:/);
  });
});

describe('typeface (AC-03)', () => {
  it('points the font stack at the Plus Jakarta Sans variable and no longer at Inter', () => {
    expect(css).toContain('var(--font-plus-jakarta)');
    expect(css).not.toMatch(/font-inter/);
  });
});

describe('theme parity (AC-01)', () => {
  function missingFrom(theme: Map<string, string>, tokens: readonly string[]): string[] {
    return tokens.filter((token) => !theme.has(token));
  }

  it('declares every semantic token in both themes', () => {
    expect(missingFrom(light, SEMANTIC_TOKENS)).toEqual([]);
    expect(missingFrom(dark, SEMANTIC_TOKENS)).toEqual([]);
  });

  it('error: a token without a dark value is reported by name', () => {
    const partial = new Map([['primary', 'oklch(0.5 0.1 265)']]);
    expect(missingFrom(partial, ['primary', 'card'])).toEqual(['card']);
  });
});

describe('contrast (NFR-01)', () => {
  const themes = [
    ['light', light],
    ['dark', dark],
  ] as const;

  describe.each(themes)('%s theme', (_name, theme) => {
    it.each(TEXT_PAIRS)('text --%s on --%s is at least 4.5:1', (foreground, background) => {
      expect(contrast(colour(theme, foreground), colour(theme, background))).toBeGreaterThanOrEqual(
        4.5,
      );
    });

    it.each(NON_TEXT_PAIRS)('border or icon --%s on --%s is at least 3:1', (token, background) => {
      expect(contrast(colour(theme, token), colour(theme, background))).toBeGreaterThanOrEqual(3);
    });
  });

  it('computes real WCAG ratios: black on white is 21:1, equal colours are 1:1', () => {
    expect(contrast({ l: 0, c: 0, h: 0 }, { l: 1, c: 0, h: 0 })).toBeCloseTo(21, 1);
    expect(contrast({ l: 0.6, c: 0.1, h: 160 }, { l: 0.6, c: 0.1, h: 160 })).toBeCloseTo(1, 5);
  });

  it('error: a pair below the threshold is detected as failing', () => {
    expect(contrast({ l: 0.75, c: 0, h: 0 }, { l: 1, c: 0, h: 0 })).toBeLessThan(4.5);
  });
});

describe('motion (AC-24)', () => {
  it('has a prefers-reduced-motion rule that shortens animations and transitions', () => {
    const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, start + 600);
    expect(rule).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(rule).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });
});

describe('tokens are the only source of design values (AC-05)', () => {
  const OWN_FILES = [
    'src/app/[locale]/layout.tsx',
    'src/app/[locale]/design-system/page.tsx',
    'src/app/[locale]/design-system/design-system-showcase.tsx',
    'src/components/theme-provider.tsx',
    'src/components/theme-toggle.tsx',
    'src/features/auth/components/form-alert.tsx',
    'src/features/auth/components/auth-field.tsx',
  ];

  function uiSources(): string[] {
    const dir = join(webRoot, 'src/components/ui');
    return readdirSync(dir)
      .map((entry) => join(dir, entry))
      .filter((file) => statSync(file).isFile() && /\.tsx$/.test(file));
  }

  const sources = [...uiSources(), ...OWN_FILES.map((file) => join(webRoot, file))].filter((file) =>
    existsSync(file),
  );

  it('finds the sources to scan', () => {
    expect(sources.length).toBeGreaterThanOrEqual(15);
  });

  it('writes no colour literal in components, and no arbitrary colour or radius utility outside ui', () => {
    const colourLiteral = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl|oklch|oklab|lab|lch)a?\(/;
    const arbitrary =
      /\b(?:text|bg|border|ring|p[xytblr]?|m[xytblr]?|gap|space-[xy]|w|h|size|min-w|min-h|rounded|shadow|font|duration|ease|outline|opacity)-\[/;
    const offenders = sources.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const inUi = file.replaceAll('\\', '/').includes('/src/components/ui/');
      return [
        ...(colourLiteral.test(text) ? [`${file}: colour literal`] : []),
        ...(!inUi && arbitrary.test(text) ? [`${file}: arbitrary design value`] : []),
      ];
    });

    expect(offenders).toEqual([]);
  });
});
