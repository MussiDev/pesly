/**
 * The reference profile of NFR-01 (spec DISC-001-09c, D12): 10 Mbps, 50 ms of latency and a CPU
 * slowed 4x. Kept free of Playwright imports so the unit tests can run it with a fake session.
 */
export const REFERENCE_PROFILE = {
  latencyMs: 50,
  /** 10 Mbps in bytes per second. */
  bytesPerSecond: 1_250_000,
  cpuSlowdown: 4,
} as const;

/** The one method of a Chrome DevTools Protocol session the profile uses. */
export interface CdpSender {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Attaches a DevTools session and applies the profile. A session that cannot be attached, or a
 * command the browser refuses, is an error: a run that is not throttled must never pass as one.
 */
export async function attachThrottling(attach: () => Promise<CdpSender>): Promise<CdpSender> {
  try {
    const session = await attach();
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: REFERENCE_PROFILE.latencyMs,
      downloadThroughput: REFERENCE_PROFILE.bytesPerSecond,
      uploadThroughput: REFERENCE_PROFILE.bytesPerSecond,
    });
    await session.send('Emulation.setCPUThrottlingRate', { rate: REFERENCE_PROFILE.cpuSlowdown });
    return session;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not attach the throttling session: ${reason}`, { cause: error });
  }
}

/** The median of the runs; the mean of the two middle ones when their count is even. */
export function median(runs: readonly number[]): number {
  if (runs.length === 0) throw new Error('There is no run to take the median of');
  const sorted = [...runs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  const lower = sorted[middle - 1] ?? upper;
  return sorted.length % 2 === 1 ? upper : (lower + upper) / 2;
}
