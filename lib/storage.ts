import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type {
  GenerationRecord,
  GenerationStatus,
  LibraryRunRecord,
  SyncRunRecord,
} from './types';

interface C2nDatabase extends DBSchema {
  generations: {
    key: string;
    value: GenerationRecord;
    indexes: {
      'by-status': GenerationStatus;
      'by-created-at': string;
    };
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
  runs: {
    key: string;
    value: SyncRunRecord;
    indexes: { 'by-started-at': number };
  };
  libraryRuns: {
    key: string;
    value: LibraryRunRecord;
    indexes: { 'by-started-at': number };
  };
}

const DATABASE_NAME = 'c2n';
const DATABASE_VERSION = 1;

let databasePromise: Promise<IDBPDatabase<C2nDatabase>> | null = null;

function database(): Promise<IDBPDatabase<C2nDatabase>> {
  if (!databasePromise) {
    databasePromise = openDB<C2nDatabase>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(db) {
        const generations = db.createObjectStore('generations', {
          keyPath: 'id',
        });
        generations.createIndex('by-status', 'status');
        generations.createIndex('by-created-at', 'createdAt');
        db.createObjectStore('meta', { keyPath: 'key' });
        const runs = db.createObjectStore('runs', { keyPath: 'id' });
        runs.createIndex('by-started-at', 'startedAt');
        const libraryRuns = db.createObjectStore('libraryRuns', {
          keyPath: 'id',
        });
        libraryRuns.createIndex('by-started-at', 'startedAt');
      },
    });
  }
  return databasePromise;
}

export async function getGeneration(
  id: string,
): Promise<GenerationRecord | undefined> {
  return (await database()).get('generations', id);
}

export async function putGeneration(record: GenerationRecord): Promise<void> {
  await (await database()).put('generations', record);
}

export async function putGenerations(
  records: GenerationRecord[],
): Promise<void> {
  if (!records.length) {
    return;
  }
  const db = await database();
  const transaction = db.transaction('generations', 'readwrite');
  await Promise.all([
    ...records.map((record) => transaction.store.put(record)),
    transaction.done,
  ]);
}

export async function getGenerationsByIds(
  ids: string[],
): Promise<GenerationRecord[]> {
  if (!ids.length) {
    return [];
  }
  const db = await database();
  const transaction = db.transaction('generations', 'readonly');
  const records = await Promise.all(ids.map((id) => transaction.store.get(id)));
  await transaction.done;
  return records.filter((record): record is GenerationRecord =>
    Boolean(record),
  );
}

export async function getAllGenerations(): Promise<GenerationRecord[]> {
  return (await database()).getAll('generations');
}

export async function getPendingGenerations(
  limit: number,
): Promise<GenerationRecord[]> {
  const db = await database();
  const pending = await db.getAllFromIndex(
    'generations',
    'by-status',
    'pending',
  );
  const failed = await db.getAllFromIndex('generations', 'by-status', 'failed');
  return [...pending, ...failed]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, limit);
}

export async function getPendingCount(): Promise<number> {
  const db = await database();
  const pending = await db.countFromIndex(
    'generations',
    'by-status',
    'pending',
  );
  const failed = await db.countFromIndex('generations', 'by-status', 'failed');
  return pending + failed;
}

export async function markGenerationUploaded(id: string): Promise<void> {
  const db = await database();
  const record = await db.get('generations', id);
  if (!record) {
    return;
  }
  await db.put('generations', {
    ...record,
    status: 'uploaded',
    uploadedAt: new Date().toISOString(),
    lastError: undefined,
  });
}

export async function markGenerationFailed(
  id: string,
  error: string,
): Promise<void> {
  const db = await database();
  const record = await db.get('generations', id);
  if (!record) {
    return;
  }
  await db.put('generations', {
    ...record,
    status: 'failed',
    lastError: error,
    attempts: record.attempts + 1,
    lastAttemptAt: new Date().toISOString(),
  });
}

export async function clearGenerations(): Promise<void> {
  const db = await database();
  await db.clear('generations');
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const entry = await (await database()).get('meta', key);
  return entry?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await database()).put('meta', { key, value });
}

export async function deleteMeta(key: string): Promise<void> {
  await (await database()).delete('meta', key);
}

export async function clearNotionCache(): Promise<void> {
  const db = await database();
  const keys = await db.getAllKeys('meta');
  await Promise.all(
    keys
      .filter((key) => key.startsWith('notion:dataSources:'))
      .map((key) => db.delete('meta', key)),
  );
}

export async function saveRun(record: SyncRunRecord): Promise<void> {
  await (await database()).put('runs', record);
}

export async function getRecentRuns(limit = 10): Promise<SyncRunRecord[]> {
  const db = await database();
  const out: SyncRunRecord[] = [];
  let cursor = await db
    .transaction('runs')
    .store.index('by-started-at')
    .openCursor(null, 'prev');
  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return out;
}

export async function saveLibraryRun(record: LibraryRunRecord): Promise<void> {
  await (await database()).put('libraryRuns', record);
}

export async function getRecentLibraryRuns(
  limit = 10,
): Promise<LibraryRunRecord[]> {
  const db = await database();
  const out: LibraryRunRecord[] = [];
  let cursor = await db
    .transaction('libraryRuns')
    .store.index('by-started-at')
    .openCursor(null, 'prev');
  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return out;
}
