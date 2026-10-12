export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** A counting limiter: at most `max` tasks run at once, the rest wait in arrival order. */
export function createLimiter(max: number): Limiter {
  let active = 0;
  const waiting: (() => void)[] = [];

  const release = (): void => {
    active -= 1;
    waiting.shift()?.();
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

export const PUSH_SEND_CONCURRENCY = 20;

/** Shared by every send of the process (NFR-06). */
export const processSendLimiter: Limiter = createLimiter(PUSH_SEND_CONCURRENCY);
