// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi, describe, expect, it } from 'vitest';
import { TagInputContainer } from '../src/features/movements/containers/tag-input-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es } = CATALOGS;

function Host({ onValue }: { onValue?: (value: string[]) => void }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <TagInputContainer
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

const box = () => screen.getByLabelText<HTMLInputElement>(es.movements.tags.label);
const type = (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
};
const tagCalls = (calls: { path: string }[]) =>
  calls.filter((call) => call.path.startsWith('/tags'));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('TagInputContainer (AC-05)', () => {
  it('waits 250 ms after the last key and asks once for the final prefix', async () => {
    const { calls } = stubApi({
      'GET /tags?prefix=abc&limit=10': { status: 200, body: { items: ['abcd'] } },
    });
    renderApp(<Host />);
    type('a');
    await wait(100);
    type('ab');
    await wait(100);
    type('abc');
    await wait(100);
    expect(tagCalls(calls)).toHaveLength(0);

    expect(await screen.findByRole('button', { name: 'abcd' })).toBeDefined();
    expect(tagCalls(calls).map((call) => call.path)).toEqual(['/tags?prefix=abc&limit=10']);
  });

  it('asks nothing for a blank prefix and clears the list when the text is erased', async () => {
    const { calls } = stubApi({
      'GET /tags?prefix=vi&limit=10': { status: 200, body: { items: ['Viaje'] } },
    });
    renderApp(<Host />);
    type('vi');
    await screen.findByRole('button', { name: 'Viaje' });

    type('');
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Viaje' })).toBeNull();
    });
    type('   ');
    await wait(350);
    expect(tagCalls(calls)).toHaveLength(1);
  });

  it('drops the answer for an older prefix that arrives late', async () => {
    const resolvers = new Map<string, (items: string[]) => void>();
    const fetch = vi.fn((url: string) => {
      const prefix = new URL(url).searchParams.get('prefix') ?? '';
      return new Promise<Response>((resolve) => {
        resolvers.set(prefix, (items) => {
          resolve(
            new Response(JSON.stringify({ items }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        });
      });
    });
    vi.stubGlobal('fetch', fetch);
    renderApp(<Host />);

    type('a');
    await waitFor(() => {
      expect(resolvers.has('a')).toBe(true);
    });
    type('ab');
    await waitFor(() => {
      expect(resolvers.has('ab')).toBe(true);
    });
    resolvers.get('ab')?.(['abeja']);
    expect(await screen.findByRole('button', { name: 'abeja' })).toBeDefined();

    resolvers.get('a')?.(['avion']);
    await wait(50);
    expect(screen.queryByRole('button', { name: 'avion' })).toBeNull();
    expect(screen.getByRole('button', { name: 'abeja' })).toBeDefined();
  });

  it('shows nothing and no banner when the request fails, and tags can still be added (error path)', async () => {
    const { calls } = stubApi({
      'GET /tags?prefix=vi&limit=10': { status: 500, body: { code: 'INTERNAL' } },
    });
    const onValue = vi.fn<(value: string[]) => void>();
    renderApp(<Host onValue={onValue} />);
    type('vi');
    await waitFor(() => {
      expect(tagCalls(calls)).toHaveLength(1);
    });
    await wait(20);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('list', { name: es.movements.tags.suggestions })).toBeNull();
    await userEvent.setup().type(box(), '{Enter}');
    expect(onValue).toHaveBeenLastCalledWith(['vi']);
  });

  it('ignores a malformed answer like a failed one (error path)', async () => {
    stubApi({ 'GET /tags?prefix=vi&limit=10': { status: 200, body: { items: [1] } } });
    renderApp(<Host />);
    type('vi');
    await wait(400);

    expect(screen.queryByRole('list', { name: es.movements.tags.suggestions })).toBeNull();
  });

  it('chooses a suggestion with its stored spelling and clears the list', async () => {
    stubApi({ 'GET /tags?prefix=vi&limit=10': { status: 200, body: { items: ['Viaje'] } } });
    const onValue = vi.fn<(value: string[]) => void>();
    renderApp(<Host onValue={onValue} />);
    type('vi');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Viaje' }));

    expect(onValue).toHaveBeenLastCalledWith(['Viaje']);
    await waitFor(() => {
      expect(screen.queryByRole('list', { name: es.movements.tags.suggestions })).toBeNull();
    });
  });
});
