// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MoneyText, wrappableMoney } from '../src/components/ui/money-text';

describe('MoneyText', () => {
  it('turns the space before the currency code into a breakable one', () => {
    expect(wrappableMoney('1.800.000,00 ARS')).toBe('1.800.000,00 ARS');
  });

  it('error: leaves a text without a code untouched', () => {
    expect(wrappableMoney('—')).toBe('—');
  });

  it('renders a single text node, so the amount is still found as one string', () => {
    const { container } = render(<MoneyText text={'5,00 USD'} />);
    expect([...container.childNodes].every((node) => node.nodeType === Node.TEXT_NODE)).toBe(true);
    expect(container.textContent).toBe('5,00 USD');
  });
});
