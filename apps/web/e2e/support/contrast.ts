import type { Page } from '@playwright/test';

/**
 * The contrast probe (spec DISC-001-09c, D11): reads the computed colors in the browser, with no
 * accessibility library. Colors are resolved to sRGB through a canvas, so any CSS color syntax the
 * theme uses (oklch, color-mix) comes out the same way; the ratios are computed here.
 */

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

export interface ContrastSample {
  /** Text needs 4.5:1; a chart line, a bar and the focus ring need 3:1. */
  kind: 'text' | 'graphic';
  /** A readable name for the failure message: tag, classes and a bit of the text. */
  element: string;
  foreground: Rgba;
  /** Already flattened: every ancestor background composited down to an opaque color. */
  background: Rgb;
}

export const TEXT_MINIMUM = 4.5;
export const GRAPHIC_MINIMUM = 3;

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The WCAG contrast ratio of two opaque colors; always 1 or more. */
export function contrastRatio(first: Rgb, second: Rgb): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** A translucent color over an opaque one. */
export function compositeOver([r, g, b, alpha]: Rgba, [br, bg, bb]: Rgb): Rgb {
  return [
    Math.round(r * alpha + br * (1 - alpha)),
    Math.round(g * alpha + bg * (1 - alpha)),
    Math.round(b * alpha + bb * (1 - alpha)),
  ];
}

/**
 * The background an element is seen on: its own and its ancestors' layers (nearest first), up to
 * the first opaque one. With nothing opaque the page is white, the browser's canvas color.
 */
export function flattenBackground(layers: readonly Rgba[]): Rgb {
  let result: Rgb = [255, 255, 255];
  for (const layer of [...layers].reverse()) {
    result = compositeOver(layer, result);
    if (layer[3] >= 1) result = [layer[0], layer[1], layer[2]];
  }
  return result;
}

function rgb([r, g, b]: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** One message per pair under its threshold, naming the element, the colors and the state. */
export function findContrastFailures(samples: readonly ContrastSample[], state: string): string[] {
  if (!samples.some((sample) => sample.kind === 'text')) {
    return [`${state}: the contrast probe found no text to measure`];
  }
  return samples.flatMap((sample) => {
    const foreground = compositeOver(sample.foreground, sample.background);
    const ratio = contrastRatio(foreground, sample.background);
    const minimum = sample.kind === 'text' ? TEXT_MINIMUM : GRAPHIC_MINIMUM;
    return ratio >= minimum
      ? []
      : [
          `${state}: ${sample.element} ${rgb(foreground)} on ${rgb(sample.background)} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`,
        ];
  });
}

interface RawSample {
  kind: 'text' | 'graphic';
  element: string;
  foreground: Rgba;
  layers: Rgba[];
}

/** Runs in the page: it must stay self-contained because Playwright serializes it. */
function collectSamples(): RawSample[] {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('No 2D canvas is available to resolve colors');

  const read = (sentinel: string, css: string): Rgba => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = sentinel;
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, (data[3] ?? 0) / 255];
  };
  // A color the canvas cannot parse leaves the sentinel in place, so two sentinels disagree.
  const resolve = (css: string): Rgba => {
    const first = read('#123456', css);
    const second = read('#654321', css);
    if (first.some((value, at) => value !== second[at])) {
      throw new Error(`The browser cannot resolve the color "${css}"`);
    }
    return first;
  };

  const layersFrom = (start: Element | null): Rgba[] => {
    const layers: Rgba[] = [];
    for (let node = start; node !== null; node = node.parentElement) {
      const layer = resolve(getComputedStyle(node).backgroundColor);
      layers.push(layer);
      if (layer[3] >= 1) break;
    }
    return layers;
  };
  const opacityOf = (start: Element): number => {
    let total = 1;
    for (let node: Element | null = start; node !== null; node = node.parentElement) {
      total *= Number(getComputedStyle(node).opacity);
    }
    return total;
  };
  const describe = (element: Element): string => {
    const classes = [...element.classList].slice(0, 2).join('.');
    const text = element.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${element.tagName.toLowerCase()}${classes === '' ? '' : `.${classes}`} "${text}"`;
  };

  const samples: RawSample[] = [];
  for (const element of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'NEXTJS-PORTAL'].includes(element.tagName)) continue;
    if (element.closest('nextjs-portal') !== null) continue;
    const hasText = [...element.childNodes].some(
      (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() !== '',
    );
    if (!hasText) continue;
    if (!element.checkVisibility({ visibilityProperty: true })) continue;
    const box = element.getBoundingClientRect();
    // `sr-only` text is clipped to one pixel: nobody reads it.
    if (box.width <= 1 || box.height <= 1) continue;
    if (element.closest(':disabled') !== null) continue;
    const style = getComputedStyle(element);
    const paint = element instanceof SVGElement ? style.fill : style.color;
    if (paint === 'none') continue;
    const color = resolve(paint);
    samples.push({
      kind: 'text',
      element: describe(element),
      foreground: [color[0], color[1], color[2], color[3] * opacityOf(element)],
      layers: layersFrom(element),
    });
  }

  for (const line of document.querySelectorAll('[data-chart-line]')) {
    const color = resolve(getComputedStyle(line).stroke);
    samples.push({
      kind: 'graphic',
      element: `chart line ${describe(line)}`,
      foreground: color,
      layers: layersFrom(line.parentElement),
    });
  }
  for (const bar of document.querySelectorAll('[data-slot="share-bar"]')) {
    samples.push({
      kind: 'graphic',
      element: `category bar ${describe(bar)}`,
      foreground: resolve(getComputedStyle(bar).backgroundColor),
      layers: layersFrom(bar.parentElement),
    });
  }

  const ring = resolve(getComputedStyle(document.documentElement).getPropertyValue('--ring'));
  for (const [name, surface] of [
    ['the page', document.querySelector('main')],
    ['a card', document.querySelector('[data-slot="card"]')],
  ] as const) {
    if (surface === null) continue;
    samples.push({
      kind: 'graphic',
      element: `focus ring (--ring) on ${name}`,
      foreground: ring,
      layers: layersFrom(surface),
    });
  }
  return samples;
}

/**
 * Measures every text node, chart graphic and the focus ring on the current screen. A failing pair
 * throws with the element, its colors and the state, so the token to fix is found at once.
 */
export async function probeContrast(page: Page, state: string): Promise<void> {
  const raw = await page.evaluate(collectSamples);
  const samples = raw.map((sample): ContrastSample => ({
    kind: sample.kind,
    element: sample.element,
    foreground: sample.foreground,
    background: flattenBackground(sample.layers),
  }));
  const failures = findContrastFailures(samples, state);
  if (failures.length > 0) {
    throw new Error(`Contrast below the threshold:\n${failures.join('\n')}`);
  }
}
