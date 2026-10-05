/** A save that fell back to the queue while the browser was online: a pass should start now. */
export const MOVEMENT_QUEUED_EVENT = 'pesly:movement-queued';

/** A pass sent at least one movement: screens that list movements can load them again. */
export const SYNC_FINISHED_EVENT = 'pesly:sync-finished';

/** Both events carry no data: what they announce is read from the queue and the server. */
function announce(name: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(name));
}

function listen(name: string, handler: () => void): () => void {
  window.addEventListener(name, handler);
  return () => {
    window.removeEventListener(name, handler);
  };
}

export function notifyMovementQueued(): void {
  announce(MOVEMENT_QUEUED_EVENT);
}

export function notifySyncFinished(): void {
  announce(SYNC_FINISHED_EVENT);
}

/** Returns the function that stops listening. */
export function onMovementQueued(handler: () => void): () => void {
  return listen(MOVEMENT_QUEUED_EVENT, handler);
}

/** Returns the function that stops listening. */
export function onSyncFinished(handler: () => void): () => void {
  return listen(SYNC_FINISHED_EVENT, handler);
}
