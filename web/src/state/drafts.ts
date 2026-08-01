export interface RecoveryDraft {
  sessionId: string;
  source: string;
  baseRevision: number;
  updatedAt: number;
}

const DATABASE = 'mdve-recovery';
const VERSION = 1;
const STORE = 'drafts';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB is unavailable; browser draft recovery is unavailable'));
      return;
    }
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'sessionId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open browser recovery storage'));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser recovery transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser recovery transaction aborted'));
  });
}

export async function writeRecoveryDraft(draft: RecoveryDraft): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, 'readwrite', { durability: 'strict' });
    transaction.objectStore(STORE).put(draft);
    await complete(transaction);
  } finally {
    db.close();
  }
}

export async function readRecoveryDraft(sessionId: string): Promise<RecoveryDraft | null> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(sessionId);
    const value = await new Promise<RecoveryDraft | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as RecoveryDraft | undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not read browser recovery storage'));
    });
    await complete(transaction);
    return value ?? null;
  } finally {
    db.close();
  }
}

export async function clearRecoveryDraft(sessionId: string, acknowledgedRevision?: number): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE, 'readwrite', { durability: 'strict' });
    const store = transaction.objectStore(STORE);
    if (acknowledgedRevision === undefined) {
      store.delete(sessionId);
    } else {
      const request = store.get(sessionId);
      request.onsuccess = () => {
        const draft = request.result as RecoveryDraft | undefined;
        if (draft && draft.baseRevision <= acknowledgedRevision) store.delete(sessionId);
      };
    }
    await complete(transaction);
  } finally {
    db.close();
  }
}
