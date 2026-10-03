import { expect, test, type Page } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';

const es = catalogs.es;

const PHONE = { width: 360, height: 780 };
const DESKTOP = { width: 1280, height: 800 };
const MIN_TARGET = 44;
const MAX_LAYOUT_SHIFT = 0.1;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

let email = '';

test.beforeAll(async ({ browser }) => {
  await resetAttemptLimits();
  email = uniqueEmail('design-system');
  const page = await browser.newPage({ locale: 'es-AR' });
  await registerAndVerify(page, email);
  await page.close();
});

test.beforeEach(async () => {
  await resetAttemptLimits();
});

async function signedIn(page: Page): Promise<void> {
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
}

test.describe('navigation by viewport (AC-12, AC-13)', () => {
  /** Both landmarks share one accessible name; the hidden one is out of the accessibility tree. */
  function navigations(page: Page) {
    return page.getByRole('navigation', { name: es.app.nav.label, includeHidden: true });
  }

  async function visibleBoxes(page: Page) {
    const all = await navigations(page).all();
    const boxes = [];
    for (const nav of all) {
      if (await nav.isVisible()) boxes.push(await nav.boundingBox());
    }
    return boxes;
  }

  test('at 360 px the bottom navigation is visible and the side navigation is hidden', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await signedIn(page);

    await expect(navigations(page)).toHaveCount(2);
    await expect(page.getByRole('navigation', { name: es.app.nav.label })).toHaveCount(1);
    const [box, ...others] = await visibleBoxes(page);
    expect(others).toHaveLength(0);
    // The bar spans the viewport width and sits in its lower half.
    expect(box?.width).toBeGreaterThanOrEqual(PHONE.width - 1);
    expect(box?.y).toBeGreaterThan(PHONE.height / 2);
    await expect(
      page.getByRole('navigation', { name: es.app.nav.label }).getByRole('link', {
        name: es.app.nav.addMovement,
      }),
    ).toBeVisible();
  });

  test('at 1280 px the side navigation is visible and the bottom navigation is hidden', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await signedIn(page);

    await expect(navigations(page)).toHaveCount(2);
    await expect(page.getByRole('navigation', { name: es.app.nav.label })).toHaveCount(1);
    const [box, ...others] = await visibleBoxes(page);
    expect(others).toHaveLength(0);
    // The side navigation is a narrow column on the left edge, as tall as the viewport.
    expect(box?.x).toBe(0);
    expect(box?.width).toBeLessThan(DESKTOP.width / 2);
    expect(box?.height).toBeGreaterThanOrEqual(DESKTOP.height - 1);
  });
});

test.describe('touch targets at 360 px (NFR-02)', () => {
  test.use({ viewport: PHONE });

  /**
   * Every visible interactive element and its hit area, in CSS pixels. Exclusions, each by design:
   * - the skip link: `sr-only` until it receives focus, so it has no box before the first Tab;
   * - any other `sr-only` element: visually hidden, not a touch target;
   * - checkbox and radio inputs: the 44 px area is the `::after` pseudo-element (checkbox) or the
   *   input stretched over its label, so the pseudo-element's computed box, or the label's box,
   *   is measured instead of the 20 px visible control.
   */
  async function undersizedTargets(page: Page): Promise<string[]> {
    return page.evaluate((min) => {
      const selector =
        'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
      const found: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        if (el.closest('nextjs-portal')) continue;
        if (!el.checkVisibility({ visibilityProperty: true })) continue;
        if (el.matches('a[href="#main-content"]') || el.classList.contains('sr-only')) continue;

        let width = el.getBoundingClientRect().width;
        let height = el.getBoundingClientRect().height;
        if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
          const after = getComputedStyle(el, '::after');
          const label = el.labels?.[0]?.getBoundingClientRect();
          width = Math.max(width, parseFloat(after.width) || 0, label?.width ?? 0);
          height = Math.max(height, parseFloat(after.height) || 0, label?.height ?? 0);
        }
        // Sub-pixel layout can yield 43.99; a whole-pixel tolerance of 0.5 is not a real shortfall.
        if (width < min - 0.5 || height < min - 0.5) {
          const name = el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40);
          found.push(
            `<${el.tagName.toLowerCase()}> "${name}" ${width.toFixed(1)}x${height.toFixed(1)}`,
          );
        }
      }
      return found;
    }, MIN_TARGET);
  }

  test('every interactive element on the sign-in page is at least 44 by 44', async ({ page }) => {
    await page.goto('/es/sign-in');
    await expect(page.getByLabel(es.auth.fields.email)).toBeVisible();

    expect(await undersizedTargets(page)).toEqual([]);
  });

  test('every interactive element on the home is at least 44 by 44', async ({ page }) => {
    await signedIn(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    expect(await undersizedTargets(page)).toEqual([]);
  });

  test('every interactive element on the movements page is at least 44 by 44', async ({ page }) => {
    await signedIn(page);
    await page.goto('/es/movements');
    // The empty list and a populated one both offer the new-movement link once loaded.
    await expect(
      page.getByRole('main').getByRole('link', { name: es.movements.list.newMovement }).first(),
    ).toBeVisible();

    expect(await undersizedTargets(page)).toEqual([]);
  });
});

interface StopReport {
  tag: string;
  label: string;
  indicated: boolean;
  wrapped: boolean;
}

/**
 * Runs in the page (Playwright serialises it, so it must stay self-contained). Reports whether the
 * focused element, or the label wrapping it, draws a VISIBLE indicator that focus causes: an
 * outline with width and alpha, or a box-shadow layer with alpha and a blur or spread, that
 * differs from the same element's indicator once blurred. A permanent `shadow-xs` or a
 * transparent shadow chain (`0 0 #0000`) therefore does not count.
 */
function inspectFocusedStop(): StopReport | 'overlay' | null {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  // The Next.js dev overlay exists only under `next dev`; it is not part of the app.
  if (el.tagName.toLowerCase() === 'nextjs-portal') return 'overlay';

  const alphaOf = (color: string): number => {
    const slash = /\/\s*([\d.]+)(%?)/.exec(color);
    if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
    const fn = /^rgba?\(([^)]*)\)/.exec(color);
    if (fn) {
      const parts = (fn[1] ?? '').split(/[,\s/]+/).filter(Boolean);
      return parts.length > 3 ? Number(parts[3]) : 1;
    }
    return color === 'transparent' ? 0 : 1;
  };
  const layersOf = (value: string): string[] => {
    const layers: string[] = [];
    let depth = 0;
    let start = 0;
    for (let at = 0; at < value.length; at += 1) {
      if (value[at] === '(') depth += 1;
      if (value[at] === ')') depth -= 1;
      if (value[at] === ',' && depth === 0) {
        layers.push(value.slice(start, at));
        start = at + 1;
      }
    }
    layers.push(value.slice(start));
    return layers.map((layer) => layer.trim());
  };
  const signature = (target: Element): string => {
    const style = getComputedStyle(target);
    const visible: string[] = [];
    if (
      style.outlineStyle !== 'none' &&
      parseFloat(style.outlineWidth) > 0 &&
      alphaOf(style.outlineColor) > 0
    ) {
      visible.push(`outline ${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`);
    }
    if (style.boxShadow !== 'none') {
      for (const layer of layersOf(style.boxShadow)) {
        const color = /(?:rgba?|hsla?|oklab|oklch|lab|lch|color)\([^)]*\)|transparent/.exec(layer);
        const [, , blur = 0, spread = 0] = (layer.match(/-?[\d.]+px/g) ?? []).map(parseFloat);
        if (color && alphaOf(color[0]) > 0 && (blur !== 0 || spread !== 0)) visible.push(layer);
      }
    }
    return visible.join(' | ');
  };

  const w = window as unknown as { __firstStop?: Element };
  const wrapped = w.__firstStop === el;
  w.__firstStop ??= el;

  // A control may draw its ring on the wrapping label (`has-focus-visible:`).
  const targets = [el, el.closest('label')].filter((target) => target !== null);
  const focused = targets.map(signature);
  (el as HTMLElement).blur();
  const blurred = targets.map(signature);
  (el as HTMLElement).focus();

  return {
    tag: el.tagName.toLowerCase(),
    label:
      el.getAttribute('aria-label') ??
      el.getAttribute('name') ??
      el.textContent.trim().slice(0, 30),
    indicated: focused.some((sign, at) => sign !== '' && sign !== blurred[at]),
    wrapped,
  };
}

test('keyboard tabbing across the sign-in page shows a focus indicator on every stop (AC-23)', async ({
  page,
}) => {
  // Transitions would leave the computed ring mid-fade right after focus. The app's own
  // reduced-motion rule ends them, and unlike an injected <style> it is not blocked by the
  // production CSP (`style-src` allows only the nonce outside `next dev`).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/es/sign-in');
  await expect(page.getByLabel(es.auth.fields.email)).toBeVisible();

  // Stops are identified by position and tag, so two stops with one name cannot end the loop.
  const stops: string[] = [];
  const unindicated: string[] = [];
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(inspectFocusedStop);
    if (stop === 'overlay') continue;
    if (stop === null || stop.wrapped) break;
    const id = `${stops.length}:${stop.tag} "${stop.label}"`;
    stops.push(id);
    if (!stop.indicated) unindicated.push(id);
  }

  expect(stops.length).toBeGreaterThanOrEqual(3);
  expect(unindicated).toEqual([]);
});

test.describe('layout shift at 360 px (NFR-03)', () => {
  test.use({ viewport: PHONE });

  const OBSERVER = `
    window.__layoutShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__layoutShift += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  `;

  /** Loads `path` as a fresh document with the observer and theme in place; returns the total. */
  async function layoutShiftOf(page: Page, path: string, theme: 'light' | 'dark'): Promise<number> {
    await page.addInitScript(
      `${OBSERVER} try { localStorage.setItem('pesly-theme', '${theme}'); } catch (e) {}`,
    );
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    // Late swaps (skeleton to content) land after the network settles.
    await page.waitForTimeout(500);
    return page.evaluate(() => (window as unknown as { __layoutShift: number }).__layoutShift);
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`the sign-in page shifts at most 0.1 in ${theme}`, async ({ page }) => {
      expect(await layoutShiftOf(page, '/es/sign-in', theme)).toBeLessThanOrEqual(MAX_LAYOUT_SHIFT);
    });

    test(`the home shifts at most 0.1 in ${theme}`, async ({ page }) => {
      await signedIn(page);

      expect(await layoutShiftOf(page, '/es', theme)).toBeLessThanOrEqual(MAX_LAYOUT_SHIFT);
    });

    test(`the movements page shifts at most 0.1 in ${theme}`, async ({ page }) => {
      await signedIn(page);

      expect(await layoutShiftOf(page, '/es/movements', theme)).toBeLessThanOrEqual(
        MAX_LAYOUT_SHIFT,
      );
    });
  }
});

test.describe('theme persistence (AC-06, AC-07)', () => {
  // The system preference is light, so a dark page can only come from the stored choice.
  test.use({ colorScheme: 'light', viewport: PHONE });

  test('a stored dark theme is applied before first paint after a reload and shown on /more', async ({
    page,
  }) => {
    await signedIn(page);
    await page.evaluate(() => {
      localStorage.setItem('pesly-theme', 'dark');
    });
    // Recorded when the document finishes parsing: the pre-paint script must have run by then.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        (window as unknown as { __darkAtParse: boolean }).__darkAtParse =
          document.documentElement.classList.contains('dark');
      });
    });

    await page.reload();
    expect(
      await page.evaluate(() => (window as unknown as { __darkAtParse: boolean }).__darkAtParse),
    ).toBe(true);
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);

    await page.goto('/es/more');
    await expect(page.getByRole('radio', { name: es.theme.dark })).toBeChecked();
    await expect(page.getByRole('radio', { name: es.theme.light })).not.toBeChecked();
  });

  test('choosing light on /more removes the dark class and survives a reload', async ({ page }) => {
    await signedIn(page);
    await page.evaluate(() => {
      localStorage.setItem('pesly-theme', 'dark');
    });
    await page.goto('/es/more');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);

    // Hydration proof: storage says dark, so the controlled radio only reads checked once the
    // provider's state is applied; clicking earlier would be reverted by React.
    await expect(page.getByRole('radio', { name: es.theme.dark })).toBeChecked();
    await page.getByRole('radio', { name: es.theme.light }).check();
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    await expect(page.getByRole('radio', { name: es.theme.light })).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('pesly-theme'))).toBe('light');
  });
});
