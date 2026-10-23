const DB_NAME = 'manga-cevirmen';
const STORE_NAME = 'labels';
const DB_VERSION = 2;
export const READING_STORES={pages:'readingPages',edits:'readingEdits',settings:'readingSettings'};
let dbPromise;

export function openDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('pageKey', 'pageKey');
          store.createIndex('sourceLanguage', 'sourceLanguage');
        }
        for(const name of Object.values(READING_STORES))if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'key'});
      };
      request.onsuccess = () => {
        const db=request.result;
        db.onversionchange=()=>{db.close();dbPromise=undefined;};
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
    dbPromise.catch(()=>{dbPromise=undefined;});
  }
  return dbPromise;
}

async function runRequest(mode, method, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = value === undefined ? store[method]() : store[method](value);
    let result;
    request.onsuccess = () => {result=request.result;};
    transaction.oncomplete=()=>resolve(result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error??new DOMException('Kayıt işlemi iptal edildi.','AbortError'));
  });
}

function validateLabel(label) {
  if (!label || typeof label !== 'object' || typeof label.id !== 'string' ||
      typeof label.correctedText !== 'string' || !label.correctedText.trim() ||
      typeof label.imageDataUrl !== 'string' ||
      !label.imageDataUrl.startsWith('data:image/png;base64,') ||
      typeof label.sourceLanguage !== 'string' ||
      typeof label.pageKey !== 'string') {
    throw new Error('Geçersiz eğitim kaydı.');
  }
  return label;
}

export async function saveLabel(label) {
  return runRequest('readwrite', 'put', validateLabel(label));
}

export async function allLabels() {
  return runRequest('readonly', 'getAll');
}

export async function countLabels() {
  return runRequest('readonly', 'count');
}

export async function deleteLabel(id) {
  return runRequest('readwrite', 'delete', id);
}

export async function importLabels(backup) {
  if (backup?.schemaVersion !== 1 || !Array.isArray(backup.labels)) {
    throw new Error('Yedek dosyasının biçimi tanınmadı.');
  }
  for (const label of backup.labels) validateLabel(label);
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    for (const label of backup.labels) store.put(label);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error??new DOMException('İçe aktarma iptal edildi.','AbortError'));
  });
  return backup.labels.length;
}
