import { createPromptAttachment, type PromptAttachment } from "./prompt-attachments";

const DB_NAME = "replit-hero-prompt";
const STORE = "attachments";

type StoredAttachment = {
  id: string;
  name: string;
  type: string;
  lastModified: number;
  size: number;
  data: ArrayBuffer;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAll(db: IDBDatabase): Promise<StoredAttachment[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const store = transaction.objectStore(STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as StoredAttachment[]);
    request.onerror = () => reject(request.error);
  });
}

async function writeAll(db: IDBDatabase, items: StoredAttachment[]) {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.clear();

    for (const item of items) {
      store.put(item);
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function fileToStored(attachment: PromptAttachment): Promise<StoredAttachment> {
  const { file, id } = attachment;

  return {
    id,
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
    size: file.size,
    data: await file.arrayBuffer(),
  };
}

function storedToAttachment(stored: StoredAttachment): PromptAttachment {
  const file = new File([stored.data], stored.name, {
    type: stored.type,
    lastModified: stored.lastModified,
  });

  return createPromptAttachment(file);
}

export async function saveHeroPromptAttachments(attachments: PromptAttachment[]) {
  if (typeof window === "undefined") return;

  const db = await openDb();
  const stored = await Promise.all(attachments.map(fileToStored));
  await writeAll(db, stored);
  db.close();
}

export async function loadHeroPromptAttachments(): Promise<PromptAttachment[]> {
  if (typeof window === "undefined") return [];

  try {
    const db = await openDb();
    const stored = await readAll(db);
    db.close();
    return stored.map(storedToAttachment);
  } catch {
    return [];
  }
}

export async function clearHeroPromptAttachments() {
  if (typeof window === "undefined") return;

  try {
    const db = await openDb();
    await writeAll(db, []);
    db.close();
  } catch {
    // ignore
  }
}