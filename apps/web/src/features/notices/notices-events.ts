/** The notices screen changed what is read: the unread badge should ask for the count again. */
export const NOTICES_CHANGED_EVENT = 'pesly:notices-changed';

/** The event carries no data: the count is read from the server. */
export function notifyNoticesChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTICES_CHANGED_EVENT));
}

export function onNoticesChanged(handler: () => void): () => void {
  window.addEventListener(NOTICES_CHANGED_EVENT, handler);
  return () => {
    window.removeEventListener(NOTICES_CHANGED_EVENT, handler);
  };
}
