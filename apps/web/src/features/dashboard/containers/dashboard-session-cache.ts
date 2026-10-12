import type { DashboardView, SeriesPointView } from '../dashboard-view';

export interface RememberedDashboard {
  view: DashboardView;
  /** Null when the series request had failed at the time. */
  points: SeriesPointView[] | null;
}

// The last successful answers of this session (D6). A module variable: it lives as long as the page
// and is never written to localStorage, sessionStorage or IndexedDB.
const memory = new Map<string, RememberedDashboard>();

export function rememberDashboard(userId: string, entry: RememberedDashboard): void {
  memory.set(userId, entry);
}

/** Only the same user id gets its own answers back; there is no fallback to another entry. */
export function recallDashboard(userId: string): RememberedDashboard | undefined {
  return memory.get(userId);
}

export function clearDashboardMemory(): void {
  memory.clear();
}
