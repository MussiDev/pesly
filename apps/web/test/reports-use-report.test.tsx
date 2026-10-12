// @vitest-environment happy-dom
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReport } from '../src/features/reports/use-report';
import type { ReportFilterValues } from '../src/features/reports/report-filters-state';
import type { ReportKind } from '../src/features/reports/report-view';
import type { ApiFailure, ApiResult } from '../src/lib/api-client';
import { renderApp } from './support/render-app';

afterEach(() => {
  vi.restoreAllMocks();
});

const fail = (code: ApiFailure['code'], fields?: string[]): ApiFailure => ({
  ok: false,
  code,
  messageKey: 'generic' as ApiFailure['messageKey'],
  ...(fields === undefined ? {} : { fields }),
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Harness({
  kind = 'categories',
  filters,
  load,
  today,
}: {
  kind?: ReportKind;
  filters: ReportFilterValues;
  load: () => Promise<ApiResult<string>>;
  today?: string;
}) {
  const { state, retry } = useReport<string>({
    kind,
    filters,
    load,
    ...(today === undefined ? {} : { today }),
  });
  return (
    <div>
      <p data-testid="status">{state.status}</p>
      {state.status === 'ready' ? <p data-testid="data">{state.data}</p> : null}
      {state.status === 'failed' ? <p data-testid="retrying">{String(state.retrying)}</p> : null}
      {state.status === 'badRange' ? <p data-testid="field">{state.field}</p> : null}
      <button type="button" onClick={retry}>
        retry
      </button>
    </div>
  );
}

const status = () => screen.getByTestId('status').textContent;
const setOnline = (online: boolean) =>
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online);

describe('useReport', () => {
  it('shows only the second answer when the first answers later (AC-47)', async () => {
    const first = defer<ApiResult<string>>();
    const second = defer<ApiResult<string>>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = renderApp(<Harness filters={{ tag: 'a' }} load={load} />);
    view.rerender(<Harness filters={{ tag: 'b' }} load={load} />);
    await act(async () => {
      second.resolve({ ok: true, data: 'second' });
      await second.promise;
    });
    await waitFor(() => {
      expect(screen.getByTestId('data').textContent).toBe('second');
    });
    await act(async () => {
      first.resolve({ ok: true, data: 'first' });
      await first.promise;
    });
    expect(screen.getByTestId('data').textContent).toBe('second');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('drops the earlier answer the moment the filters change', async () => {
    const next = defer<ApiResult<string>>();
    const load = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: 'old' })
      .mockReturnValueOnce(next.promise);
    const view = renderApp(<Harness filters={{ tag: 'a' }} load={load} />);
    await screen.findByText('old');
    view.rerender(<Harness filters={{ tag: 'b' }} load={load} />);
    expect(status()).toBe('loading');
    expect(screen.queryByText('old')).toBeNull();
  });

  it('sends exactly one request per filter change (AC-42)', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, data: 'x' });
    const view = renderApp(<Harness filters={{}} load={load} />);
    await screen.findByText('x');
    expect(load).toHaveBeenCalledTimes(1);
    view.rerender(<Harness filters={{ tag: 'b' }} load={load} />);
    await waitFor(() => {
      expect(load).toHaveBeenCalledTimes(2);
    });
    // Same filters again (new object, same key): nothing is sent.
    view.rerender(<Harness filters={{ tag: 'b' }} load={load} />);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('retry is single-flight and flags retrying while in flight (FR-22)', async () => {
    const again = defer<ApiResult<string>>();
    const load = vi.fn().mockResolvedValueOnce(fail('INTERNAL')).mockReturnValueOnce(again.promise);
    renderApp(<Harness filters={{}} load={load} />);
    await waitFor(() => {
      expect(status()).toBe('failed');
    });
    expect(screen.getByTestId('retrying').textContent).toBe('false');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'retry' }));
    await user.click(screen.getByRole('button', { name: 'retry' }));
    expect(screen.getByTestId('retrying').textContent).toBe('true');
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => {
      again.resolve({ ok: true, data: 'back' });
      await again.promise;
    });
    await screen.findByText('back');
  });

  it('a 401 drops the data and sends the user to sign-in with the report path (AC-48)', async () => {
    const load = vi.fn().mockResolvedValue(fail('UNAUTHENTICATED'));
    const { router } = renderApp(<Harness filters={{}} load={load} />, {
      pathname: '/reports/net-worth',
    });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(
        expect.stringContaining('/sign-in?next=%2Freports%2Fnet-worth'),
      );
    });
    expect(screen.queryByTestId('data')).toBeNull();
  });

  it('offline sends no request, shows offline, and retry works once back online (AC-43, AC-44)', async () => {
    setOnline(false);
    const load = vi.fn().mockResolvedValue({ ok: true, data: 'fresh' });
    renderApp(<Harness filters={{}} load={load} />);
    await waitFor(() => {
      expect(status()).toBe('offline');
    });
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByTestId('data')).toBeNull();
    setOnline(true);
    await userEvent.setup().click(screen.getByRole('button', { name: 'retry' }));
    await screen.findByText('fresh');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retry while still offline sends nothing', async () => {
    setOnline(false);
    const load = vi.fn();
    renderApp(<Harness filters={{}} load={load} />);
    await waitFor(() => {
      expect(status()).toBe('offline');
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'retry' }));
    expect(load).not.toHaveBeenCalled();
    expect(status()).toBe('offline');
  });

  it('a 404 gives filterGone (AC-27)', async () => {
    renderApp(<Harness filters={{}} load={vi.fn().mockResolvedValue(fail('NOT_FOUND'))} />);
    await waitFor(() => {
      expect(status()).toBe('filterGone');
    });
  });

  it('a 400 naming query.to gives badRange with the field and no figures (AC-34)', async () => {
    renderApp(
      <Harness
        filters={{}}
        load={vi.fn().mockResolvedValue(fail('VALIDATION_FAILED', ['query.to']))}
      />,
    );
    await waitFor(() => {
      expect(status()).toBe('badRange');
    });
    expect(screen.getByTestId('field').textContent).toBe('to');
    expect(screen.queryByTestId('data')).toBeNull();
  });

  it('a 400 naming other fields is a plain failure', async () => {
    renderApp(
      <Harness
        filters={{}}
        load={vi.fn().mockResolvedValue(fail('VALIDATION_FAILED', ['query.tag']))}
      />,
    );
    await waitFor(() => {
      expect(status()).toBe('failed');
    });
  });

  it('a network failure while online is failed, not offline', async () => {
    renderApp(<Harness filters={{}} load={vi.fn().mockResolvedValue(fail('NETWORK'))} />);
    await waitFor(() => {
      expect(status()).toBe('failed');
    });
  });

  it('a network failure with the device offline is offline', async () => {
    const load = vi.fn().mockImplementation(() => {
      setOnline(false);
      return Promise.resolve(fail('NETWORK'));
    });
    renderApp(<Harness filters={{}} load={load} />);
    await waitFor(() => {
      expect(status()).toBe('offline');
    });
  });

  it('a range that fails the local check sends no request and gives badRange (AC-32, AC-33)', () => {
    const load = vi.fn();
    const view = renderApp(
      <Harness filters={{ from: '2026-05-02', to: '2026-05-01' }} load={load} today="2026-10-12" />,
    );
    expect(status()).toBe('badRange');
    view.rerender(
      <Harness
        kind="incomeExpenses"
        filters={{ from: '2025-01-01', to: '2026-02-01' }}
        load={load}
        today="2026-10-12"
      />,
    );
    expect(status()).toBe('badRange');
    expect(load).not.toHaveBeenCalled();
  });

  it('ignores an answer that arrives after unmount', async () => {
    const pending = defer<ApiResult<string>>();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = renderApp(<Harness filters={{}} load={() => pending.promise} />);
    view.unmount();
    await act(async () => {
      pending.resolve({ ok: true, data: 'late' });
      await pending.promise;
    });
    expect(error).not.toHaveBeenCalled();
  });
});
