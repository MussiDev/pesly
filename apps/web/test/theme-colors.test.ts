import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_COLORS } from '../src/lib/theme-colors';

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const css = readFileSync(join(webRoot, 'src/app/globals.css'), 'utf8').replace(/\r\n/g, '\n');

function token(selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('\n}', start));
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(body);
  if (!match) throw new Error(`--${name} missing in ${selector}`);
  return (match[1] as string).trim();
}

/** OKLCH to 8-bit sRGB channels (gamma encoded, clipped). */
function oklchToRgb(value: string): number[] {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!match) throw new Error(`not an oklch() value: ${value}`);
  const [l, c, h] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return linear.map((x) => {
    const clipped = Math.min(1, Math.max(0, x));
    const encoded = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  });
}

function hexToRgb(hex: string): number[] {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

describe('theme colours outside CSS', () => {
  it.each([
    ['lightBackground', ':root', 'background'],
    ['darkBackground', '.dark', 'background'],
    ['brand', ':root', 'primary'],
  ] as const)('%s matches the --%s token it mirrors', (key, selector, name) => {
    const expected = oklchToRgb(token(selector, name));
    const actual = hexToRgb(THEME_COLORS[key]);
    actual.forEach((channel, index) => {
      expect(Math.abs(channel - (expected[index] as number))).toBeLessThanOrEqual(3);
    });
  });

  it('error: a token that is not oklch() is rejected', () => {
    expect(() => oklchToRgb('#fff')).toThrow(/oklch/);
  });
});
