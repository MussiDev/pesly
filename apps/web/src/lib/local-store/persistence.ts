export type PersistenceResult = 'granted' | 'denied' | 'unsupported';

/**
 * Asks the browser to keep this origin's storage from being evicted under pressure. The copy on
 * the device is only useful if it survives, so a refusal is reported and the caller tells the user.
 * A failing request counts as a refusal; a browser without the Storage API is not an error at all.
 */
export async function requestPersistentStorage(): Promise<PersistenceResult> {
  if (typeof navigator === 'undefined') return 'unsupported';
  const storage = (navigator as { storage?: Partial<StorageManager> }).storage;
  if (typeof storage?.persist !== 'function') return 'unsupported';
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'granted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
