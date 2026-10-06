/** The wait before the first retry of a pass that stopped on a network or server error. */
export const BACKOFF_START_SECONDS = 5;

/** The longest wait between two retries (PRD DISC-001-04c, NFR-01). */
export const BACKOFF_CAP_SECONDS = 300;

/**
 * The wait before retry number `attempt` (1 for the first): 5 s, doubled each time, capped at 300 s.
 * Anything that is not a whole number of at least 1 is read as the first attempt.
 */
export function retryDelaySeconds(attempt: number): number {
  const n = Number.isInteger(attempt) && attempt >= 1 ? attempt : 1;
  return Math.min(BACKOFF_START_SECONDS * 2 ** (n - 1), BACKOFF_CAP_SECONDS);
}
