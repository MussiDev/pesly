// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MovementAvatar } from '../src/features/movements/components/movement-avatar';

afterEach(cleanup);

const CATEGORY = { categoryIcon: 'banknote', categoryColor: 'green' };

describe('MovementAvatar (AC-21, AC-22, AC-23)', () => {
  it('shows the merchant logo of an expense whose note names a catalog merchant', () => {
    const { container } = render(
      <MovementAvatar type="expense" note="Suscripción Netflix" {...CATEGORY} />,
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/logos/netflix.svg');
    expect(container.querySelector('[data-icon]')).toBeNull();
  });

  it('shows the merchant logo of an income too', () => {
    const { container } = render(
      <MovementAvatar type="income" note="Reembolso de Airbnb" {...CATEGORY} />,
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/logos/airbnb.svg');
  });

  it('falls back to the merchant initial when the logo fails to load', () => {
    const { container } = render(<MovementAvatar type="expense" note="Spotify" {...CATEGORY} />);

    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('S');
  });

  it('keeps the category icon when no merchant is named, with a note or without one', () => {
    for (const note of ['almuerzo', '', null, undefined]) {
      const { container, unmount } = render(
        <MovementAvatar type="expense" note={note} {...CATEGORY} />,
      );

      expect(container.querySelector('img'), String(note)).toBeNull();
      expect(container.querySelector('[data-icon="banknote"]'), String(note)).not.toBeNull();
      unmount();
    }
  });

  it('error: a transfer or an exchange never shows a logo, even when its note names a merchant', () => {
    for (const type of ['transfer', 'exchange'] as const) {
      const { container, unmount } = render(
        <MovementAvatar type={type} note="Spotify" {...CATEGORY} />,
      );

      expect(container.querySelector('img'), type).toBeNull();
      expect(container.querySelector('[data-slot="avatar"] svg'), type).not.toBeNull();
      expect(container.querySelector('[data-icon]'), type).toBeNull();
      unmount();
    }
  });

  it('error: a category with unknown icon and color still renders a neutral visual', () => {
    const { container } = render(
      <MovementAvatar
        type="expense"
        note={null}
        categoryIcon={undefined}
        categoryColor={undefined}
      />,
    );

    expect(container.querySelector('[data-icon="unknown"]')).not.toBeNull();
  });
});
