export interface FanOutBatchResult {
  /** Notices marked handled by the batch, including the skipped ones. */
  examined: number;
  /** Deliveries newly created. */
  deliveries: number;
}

export interface PushFanOut {
  /**
   * One transaction: locks up to `limit` unhandled notices, creates their deliveries and marks them
   * handled at `now`. A failure rolls everything back.
   */
  runBatch(input: { now: Date; limit: number }): Promise<FanOutBatchResult>;
}
