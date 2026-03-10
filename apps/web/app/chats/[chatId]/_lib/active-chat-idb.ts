const DB_NAME = 'opengram-state';
const STORE_NAME = 'ui-state';
const KEY = 'activeChatId';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function setActiveChatId(chatId: string | null): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      if (chatId === null) {
        store.delete(KEY);
      } else {
        store.put(chatId, KEY);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fail silently — worst case is an extra notification
  } finally {
    db?.close();
  }
}
