// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { TagInput } from '../src/features/movements/components/tag-input';

afterEach(cleanup);

function Harness({
  initial = [],
  suggestions = [],
  onPrefixChange,
  onValue,
}: {
  initial?: string[];
  suggestions?: string[];
  onPrefixChange?: (prefix: string) => void;
  onValue?: (value: string[]) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TagInput
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
      suggestions={suggestions}
      onPrefixChange={onPrefixChange ?? (() => undefined)}
    />
  );
}

function renderTagInput(props: Parameters<typeof Harness>[0] = {}, locale: 'es' | 'en' = 'es') {
  const catalog = locale === 'es' ? es : en;
  render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={catalog}>
      <Harness {...props} />
    </NextIntlClientProvider>,
  );
  return catalog;
}

const box = () => screen.getByRole<HTMLInputElement>('textbox', { name: es.movements.tags.label });

describe('TagInput', () => {
  it('adds the trimmed text on Enter and clears the box (AC-03)', async () => {
    const onValue = vi.fn<(value: string[]) => void>();
    renderTagInput({ onValue });
    await userEvent.setup().type(box(), '  Viaje  {Enter}');

    expect(onValue).toHaveBeenLastCalledWith(['Viaje']);
    expect(box().value).toBe('');
  });

  it('adds on comma and never types the comma (AC-03)', async () => {
    const onValue = vi.fn<(value: string[]) => void>();
    renderTagInput({ onValue });
    await userEvent.setup().type(box(), 'Auto,');

    expect(onValue).toHaveBeenLastCalledWith(['Auto']);
    expect(box().value).toBe('');
  });

  it('ignores a tag equal to a chosen one in another case (AC-03)', async () => {
    const onValue = vi.fn<(value: string[]) => void>();
    renderTagInput({ initial: ['Viaje'], onValue });
    await userEvent.setup().type(box(), 'VIAJE{Enter}');

    expect(onValue).not.toHaveBeenCalled();
    expect(box().value).toBe('');
  });

  it('refuses the 11th tag with the limit message (invalid input) (AC-04)', async () => {
    const onValue = vi.fn<(value: string[]) => void>();
    renderTagInput({ initial: Array.from({ length: 10 }, (_, i) => `t${i}`), onValue });
    await userEvent.setup().type(box(), 'otra{Enter}');

    expect(onValue).not.toHaveBeenCalled();
    expect(screen.getByText(es.movements.tags.errors.limit.replace('{limit}', '10'))).toBeDefined();
  });

  it('refuses empty and over-30 code point tags (invalid input) (AC-06)', async () => {
    const onValue = vi.fn<(value: string[]) => void>();
    renderTagInput({ onValue });
    const user = userEvent.setup();
    await user.type(box(), '{Enter}');
    expect(screen.getByText(es.movements.tags.errors.empty)).toBeDefined();

    // 31 code points that are 62 UTF-16 units: the limit counts code points.
    fireEvent.change(box(), { target: { value: '\u{1F600}'.repeat(31) } });
    await user.type(box(), '{Enter}');
    expect(screen.getByText(es.movements.tags.errors.tooLong.replace('{max}', '30'))).toBeDefined();
    expect(onValue).not.toHaveBeenCalled();

    fireEvent.change(box(), { target: { value: '\u{1F600}'.repeat(30) } });
    await user.type(box(), '{Enter}');
    expect(onValue).toHaveBeenCalledTimes(1);
  });

  it('clears the message when the user types again (AC-06)', async () => {
    renderTagInput();
    const user = userEvent.setup();
    await user.type(box(), '{Enter}');
    await user.type(box(), 'a');

    expect(screen.queryByText(es.movements.tags.errors.empty)).toBeNull();
  });

  it('reports every change of the typed text as the prefix (AC-05)', async () => {
    const onPrefixChange = vi.fn<(prefix: string) => void>();
    renderTagInput({ onPrefixChange });
    await userEvent.setup().type(box(), 'vi');

    expect(onPrefixChange.mock.calls.map(([prefix]) => prefix)).toEqual(['v', 'vi']);
  });

  it('adds the stored spelling of a chosen suggestion and clears the prefix (AC-05)', async () => {
    const onValue = vi.fn<(value: string[]) => void>();
    const onPrefixChange = vi.fn<(prefix: string) => void>();
    renderTagInput({ suggestions: ['Viaje', 'Vivero'], onValue, onPrefixChange });
    const user = userEvent.setup();
    await user.type(box(), 'vi');
    await user.click(screen.getByRole('button', { name: 'Viaje' }));

    expect(onValue).toHaveBeenLastCalledWith(['Viaje']);
    expect(onPrefixChange).toHaveBeenLastCalledWith('');
    expect(box().value).toBe('');
  });

  it('does not suggest a tag that is already chosen (AC-05)', () => {
    renderTagInput({ initial: ['Viaje'], suggestions: ['viaje', 'Vivero'] });

    const list = screen.getByRole('list', { name: es.movements.tags.suggestions });
    expect(list.textContent).toBe('Vivero');
  });

  it('shows no suggestion list when there are none (AC-05)', () => {
    renderTagInput();

    expect(screen.queryByRole('list', { name: es.movements.tags.suggestions })).toBeNull();
  });

  it('removes a chip with a named button operable by keyboard (AC-03)', async () => {
    const onValue = vi.fn<(value: string[]) => void>();
    renderTagInput({ initial: ['Viaje', 'Auto'], onValue });
    const user = userEvent.setup();
    const remove = screen.getByRole('button', {
      name: es.movements.tags.remove.replace('{tag}', 'Viaje'),
    });
    remove.focus();
    await user.keyboard('{Enter}');

    expect(onValue).toHaveBeenLastCalledWith(['Auto']);
  });

  it('shows the English wording (AC-03)', async () => {
    renderTagInput({}, 'en');
    await userEvent.setup().type(screen.getByLabelText(en.movements.tags.label), '{Enter}');

    expect(screen.getByText(en.movements.tags.errors.empty)).toBeDefined();
  });
});

describe('source check: presentational files import no container and no api client (AC-05)', () => {
  const FILES = [
    '../src/features/movements/components/tag-input.tsx',
    '../src/features/movements/components/movement-form.tsx',
    '../src/features/movements/components/movement-filters.tsx',
  ];

  it.each(FILES)('%s', (relative) => {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    // movement-filters.tsx arrives in Block 6; a missing file has nothing to check yet.
    if (!existsSync(path)) return;
    const imports = [...readFileSync(path, 'utf8').matchAll(/from\s+'([^']+)'/g)].map(
      (match) => match[1] ?? '',
    );

    expect(imports.filter((source) => source.includes('containers/'))).toEqual([]);
    expect(imports.filter((source) => source.includes('api-client'))).toEqual([]);
  });
});
