import type { Clock } from './ports/clock';
import type { FanOutBatchResult, PushFanOut } from './ports/push-fan-out';

export const FAN_OUT_BATCH_SIZE = 500;

/** Turns new notices into one pending delivery per device of their owner. */
export class FanOutNotices {
  constructor(
    private readonly fanOut: PushFanOut,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<FanOutBatchResult> {
    const total: FanOutBatchResult = { examined: 0, deliveries: 0 };
    for (;;) {
      const batch = await this.fanOut.runBatch({
        now: this.clock.now(),
        limit: FAN_OUT_BATCH_SIZE,
      });
      total.examined += batch.examined;
      total.deliveries += batch.deliveries;
      if (batch.examined < FAN_OUT_BATCH_SIZE) return total;
    }
  }
}
