import type { Page } from '@playwright/test';

/**
 * Helpers that reach into the browser's IndexedDB for what a flow cannot do through the screen: put
 * a long queue in place, read the ids that are waiting, and empty the cached rates. They run inside
 * the page, in the database of the user whose pointer the app wrote.
 */

/** Adds `count` valid expenses to the queue of the signed-in user, as if they had been saved offline. */
export async function seedQueue(
  page: Page,
  { accountId, categoryId, count }: { accountId: string; categoryId: string; count: number },
): Promise<void> {
  await page.evaluate(
    async ({ accountId: account, categoryId: category, count: total }) => {
      const pointer = JSON.parse(localStorage.getItem('pesly.session') ?? 'null') as {
        userId: string;
      } | null;
      if (pointer === null) throw new Error('The app has not written the session pointer yet');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`pesly-${pointer.userId}`);
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('Could not open the local database'));
        };
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('queue', 'readwrite');
        const queue = transaction.objectStore('queue');
        const base = Date.now();
        for (let index = 0; index < total; index += 1) {
          const id = crypto.randomUUID();
          queue.put({
            id,
            createdAt: new Date(base + index).toISOString(),
            request: {
              id,
              type: 'expense',
              accountId: account,
              categoryId: category,
              amount: '1000',
              occurredAt: new Date(base - 3_600_000 - index * 1000).toISOString(),
              rate: { source: 'manual', value: '12000000' },
            },
          });
        }
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onerror = () => {
          reject(transaction.error ?? new Error('Could not write the queue'));
        };
      });
      database.close();
    },
    { accountId, categoryId, count },
  );
}

/** The ids waiting in the queue of the signed-in user, in the order the app reads them. */
export async function queuedIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const pointer = JSON.parse(localStorage.getItem('pesly.session') ?? 'null') as {
      userId: string;
    } | null;
    if (pointer === null) throw new Error('The app has not written the session pointer yet');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`pesly-${pointer.userId}`);
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('Could not open the local database'));
      };
    });
    const items = await new Promise<{ id: string }[]>((resolve, reject) => {
      const request = database.transaction('queue', 'readonly').objectStore('queue').getAll();
      request.onsuccess = () => {
        resolve(request.result as { id: string }[]);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('Could not read the queue'));
      };
    });
    database.close();
    return items.map((item) => item.id).sort();
  });
}

/** Empties the rates kept on the device, as if none had been stored when the copy was made. */
export async function clearCachedRates(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const pointer = JSON.parse(localStorage.getItem('pesly.session') ?? 'null') as {
      userId: string;
    } | null;
    if (pointer === null) throw new Error('The app has not written the session pointer yet');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`pesly-${pointer.userId}`);
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('Could not open the local database'));
      };
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('reference', 'readwrite');
      transaction.objectStore('reference').put([], 'rates');
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error('Could not write the rates'));
      };
    });
    database.close();
  });
}
