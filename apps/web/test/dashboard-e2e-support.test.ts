import { describe, expect, it, vi } from 'vitest';
import {
  compositeOver,
  contrastRatio,
  flattenBackground,
  findContrastFailures,
  type ContrastSample,
} from '../e2e/support/contrast';
import {
  FIRST_STEPS_DASHBOARD,
  NO_RATE_DASHBOARD,
  readyDashboard,
} from '../e2e/support/dashboard-fixtures';
import { attachThrottling, median, REFERENCE_PROFILE } from '../e2e/support/lab-profile';
import { dashboardResponseSchema } from '../src/lib/dashboard-contract';

describe('contrast math (NFR-03)', () => {
  it('rates black on white 21:1 and a color on itself 1:1', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([120, 130, 140], [120, 130, 140])).toBeCloseTo(1, 5);
  });

  it('is symmetric: the lighter color is always the numerator', () => {
    expect(contrastRatio([10, 20, 30], [240, 240, 240])).toBeCloseTo(
      contrastRatio([240, 240, 240], [10, 20, 30]),
      10,
    );
  });

  it('composites a translucent color over its background', () => {
    expect(compositeOver([0, 0, 0, 0.5], [255, 255, 255])).toEqual([128, 128, 128]);
    expect(compositeOver([10, 20, 30, 1], [255, 255, 255])).toEqual([10, 20, 30]);
    expect(compositeOver([10, 20, 30, 0], [200, 100, 50])).toEqual([200, 100, 50]);
  });
});

describe('background flattening (NFR-03)', () => {
  it('layers the ancestors from the nearest, stopping at the first opaque one', () => {
    expect(
      flattenBackground([
        [0, 0, 0, 0.5],
        [200, 200, 200, 1],
        [1, 2, 3, 1],
      ]),
    ).toEqual([100, 100, 100]);
  });

  it('falls back to white when every ancestor is transparent', () => {
    expect(flattenBackground([[5, 5, 5, 0]])).toEqual([255, 255, 255]);
    expect(flattenBackground([])).toEqual([255, 255, 255]);
  });
});

describe('contrast failures (NFR-03, invalid input)', () => {
  const sample = (patch: Partial<ContrastSample>): ContrastSample => ({
    kind: 'text',
    element: 'p.text-small "Gastos"',
    foreground: [150, 150, 150, 1],
    background: [255, 255, 255],
    ...patch,
  });

  it('passes a text pair of 4.5:1 or more and a graphic pair of 3:1 or more', () => {
    expect(
      findContrastFailures(
        [
          sample({ foreground: [0, 0, 0, 1] }),
          sample({ kind: 'graphic', foreground: [118, 118, 118, 1] }),
        ],
        'ready',
      ),
    ).toEqual([]);
  });

  it('error: a failing text pair names the element, both colors, the ratio and the state', () => {
    const [message, ...others] = findContrastFailures([sample({})], 'no-rate (dark)');

    expect(others).toEqual([]);
    expect(message).toContain('no-rate (dark)');
    expect(message).toContain('p.text-small "Gastos"');
    expect(message).toContain('rgb(150, 150, 150)');
    expect(message).toContain('rgb(255, 255, 255)');
    expect(message).toMatch(/2\.\d+:1/);
    expect(message).toContain('4.5:1');
  });

  it('error: a graphic is held to 3:1, not 4.5:1', () => {
    const light = sample({ kind: 'graphic', foreground: [200, 200, 200, 1] });

    const failures = findContrastFailures([sample({ foreground: [0, 0, 0, 1] }), light], 'ready');

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('needs 3:1');
  });

  it('error: a probe that read no element at all is an error, never a silent pass', () => {
    expect(findContrastFailures([], 'ready')).toEqual([
      'ready: the contrast probe found no text to measure',
    ]);
  });
});

describe('the lab profile (NFR-01, invalid input)', () => {
  it('is the reference profile of D12: 10 Mbps, 50 ms and a CPU slowed 4x', () => {
    expect(REFERENCE_PROFILE).toEqual({
      latencyMs: 50,
      bytesPerSecond: 1_250_000,
      cpuSlowdown: 4,
    });
  });

  it('error: a throttling session that cannot be attached is an error, never a silent pass', async () => {
    const attach = vi.fn().mockRejectedValue(new Error('no CDP'));

    await expect(attachThrottling(attach)).rejects.toThrow(
      /Could not attach the throttling session: no CDP/,
    );
  });

  it('error: a throttling command the browser refuses is an error too', async () => {
    const send = vi.fn().mockRejectedValue(new Error('refused'));

    await expect(attachThrottling(() => Promise.resolve({ send }))).rejects.toThrow(
      /Could not attach the throttling session: refused/,
    );
  });

  it('sends the network and the CPU commands of the profile', async () => {
    const send = vi.fn().mockResolvedValue(undefined);

    await attachThrottling(() => Promise.resolve({ send }));

    expect(send).toHaveBeenCalledWith('Network.emulateNetworkConditions', {
      offline: false,
      latency: 50,
      downloadThroughput: 1_250_000,
      uploadThroughput: 1_250_000,
    });
    expect(send).toHaveBeenCalledWith('Emulation.setCPUThrottlingRate', { rate: 4 });
  });

  it('takes the median of an odd list of runs', () => {
    expect(median([2400, 900, 1800, 3000, 1000])).toBe(1800);
  });

  it('error: the median of no run is an error', () => {
    expect(() => median([])).toThrow(/no run/i);
  });
});

describe('the provisional 09b fixtures match the contract parser (D1)', () => {
  it('parses the ready response, the first-steps response and the no-rate response', () => {
    for (const body of [
      readyDashboard(),
      readyDashboard(FIRST_STEPS_DASHBOARD),
      readyDashboard(NO_RATE_DASHBOARD),
    ]) {
      expect(dashboardResponseSchema.safeParse(body).success).toBe(true);
    }
  });

  it('keeps the unavailable conversion and the guide in their own variants', () => {
    expect(readyDashboard(NO_RATE_DASHBOARD).netWorth.total).toBeNull();
    expect(readyDashboard(FIRST_STEPS_DASHBOARD).firstSteps.show).toBe(true);
    expect(readyDashboard().firstSteps.show).toBe(false);
    expect(readyDashboard().actions.length).toBeGreaterThan(0);
  });

  it('error: an override that breaks the contract is refused when the fixture is built', () => {
    expect(() =>
      readyDashboard({ currency: 'EUR' } as unknown as Partial<ReturnType<typeof readyDashboard>>),
    ).toThrow();
  });
});
