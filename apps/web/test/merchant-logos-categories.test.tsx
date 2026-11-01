// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CategoryVisual } from '../src/features/categories/components/category-visual';
import { MovementAvatar } from '../src/features/movements/components/movement-avatar';
import { MERCHANT_CATALOG } from '../src/lib/logos/merchant-catalog';
import { resolveMerchant, resolveMerchantName } from '../src/lib/logos/resolve-merchant';

afterEach(cleanup);

describe('resolveMerchantName (FEAT-017)', () => {
  it('matches a category name that is exactly a merchant, ignoring case and accents', () => {
    expect(resolveMerchantName('Netflix')?.id).toBe('netflix');
    expect(resolveMerchantName('CITROËN')?.id).toBe('citroen');
    expect(resolveMerchantName('mercado pago')?.id).toBe('mercadopago');
    expect(resolveMerchantName(' Plan Rombo ')?.id).toBe('renault');
  });

  it('error: a name that only contains a merchant, or no name, has no logo', () => {
    expect(resolveMerchantName('Ropa de Zara y otras')).toBeUndefined();
    expect(resolveMerchantName('Auto')).toBeUndefined();
    expect(resolveMerchantName('')).toBeUndefined();
    expect(resolveMerchantName(null)).toBeUndefined();
    expect(resolveMerchantName(undefined)).toBeUndefined();
  });
});

describe('the new merchants in notes and statement lines (FEAT-017)', () => {
  it('names the car brand of a statement line', () => {
    expect(resolveMerchant('CHEVROLET SA PLAN 12/84')?.id).toBe('chevrolet');
    expect(resolveMerchant('PLAN OVALO CUOTA 3')?.id).toBe('ford');
    expect(resolveMerchant('AUTOAHORRO VW 45/84')?.id).toBe('volkswagen');
    expect(resolveMerchant('ZARA ALTO PALERMO')?.id).toBe('zara');
    expect(resolveMerchant('CLAUDE.AI SUBSCRIPTION')?.id).toBe('claude');
  });

  it('prefers Google Drive over Google for a Google Drive line', () => {
    expect(resolveMerchant('GOOGLE DRIVE 100GB')?.id).toBe('googledrive');
    expect(resolveMerchant('GOOGLE *YOUTUBEPREMIUM')?.id).toBe('google');
  });

  it('keeps every catalog logo under /logos/', () => {
    for (const entry of MERCHANT_CATALOG) expect(entry.logo).toMatch(/^\/logos\/[a-z0-9-]+\.svg$/);
  });
});

describe('CategoryVisual with a merchant name (FEAT-017)', () => {
  it('shows the logo of a category named like a merchant', () => {
    const { container } = render(<CategoryVisual icon="tv" color="red" name="Netflix" />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/logos/netflix.svg');
    expect(container.querySelector('[data-merchant="netflix"]')).not.toBeNull();
  });

  it('falls back to the category icon when the logo fails to load', () => {
    const { container } = render(<CategoryVisual icon="tv" color="red" name="Netflix" />);

    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back to the emoji of an emoji icon when the logo fails', () => {
    const { container } = render(<CategoryVisual icon="emoji:🍕" color="red" name="Toyota" />);

    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    expect(container.textContent).toContain('🍕');
  });

  it('keeps the icon and color of a category with any other name or none', () => {
    for (const name of ['Comida', undefined, null]) {
      const { container, unmount } = render(
        <CategoryVisual icon="banknote" color="green" name={name} />,
      );

      expect(container.querySelector('img'), String(name)).toBeNull();
      expect(container.querySelector('[data-icon="banknote"]'), String(name)).not.toBeNull();
      unmount();
    }
  });
});

describe('MovementAvatar with a merchant category (FEAT-017)', () => {
  const CATEGORY = { categoryIcon: 'car', categoryColor: 'blue' };

  it('shows the logo of a category named like a merchant when the note names none', () => {
    const { container } = render(
      <MovementAvatar type="expense" note="cuota" categoryName="Chevrolet" {...CATEGORY} />,
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/logos/chevrolet.svg');
  });

  it('prefers the merchant the note names over the category name', () => {
    const { container } = render(
      <MovementAvatar type="expense" note="Spotify" categoryName="Netflix" {...CATEGORY} />,
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/logos/spotify.svg');
  });
});
