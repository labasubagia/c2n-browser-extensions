import { getUsableAuthSession } from './auth';
import { deleteLibraryFile, getLibraryImages } from './chatgpt';
import { deleteMeta, getMeta, saveLibraryRun, setMeta } from './storage';
import type { LibraryItem, LibraryRunRecord, LibraryScanResult, LibraryState, RunError } from './types';
import { errorMessage, isAbortError } from './util';

const STATE_KEY = 'libraryState';
const SCAN_KEY = 'libraryScan';
const MAX_ERRORS = 50;
const DELETE_CONCURRENCY = 4;

const EMPTY_STATE: LibraryState = {
  running: false,
  phase: 'idle',
  runId: null,
  query: '',
  startedAt: null,
  finishedAt: null,
  total: 0,
  deleted: 0,
  failed: 0,
  message: '',
  errors: [],
};

export interface LibraryScanData {
  query: string;
  items: LibraryItem[];
  scannedAt: number;
}

let state: LibraryState = { ...EMPTY_STATE };
let lastScan: LibraryScanData | null = null;
let active: { id: string; controller: AbortController } | null = null;
let listener: ((state: LibraryState) => void) | null = null;

export function setLibraryStateListener(next: ((state: LibraryState) => void) | null): void {
  listener = next;
}

export function getLibraryState(): LibraryState {
  return state;
}

export function getLastLibraryScan(): LibraryScanData | null {
  return lastScan;
}

async function saveLastScan(scan: LibraryScanData | null): Promise<void> {
  lastScan = scan;
  if (scan) {
    await setMeta(SCAN_KEY, scan);
  } else {
    await deleteMeta(SCAN_KEY);
  }
}

async function update(patch: Partial<LibraryState>): Promise<LibraryState> {
  state = { ...state, ...patch };
  if (state.errors.length > MAX_ERRORS) {
    state = { ...state, errors: state.errors.slice(-MAX_ERRORS) };
  }
  listener?.(state);
  await setMeta(STATE_KEY, state);
  return state;
}

export async function restoreLibraryState(): Promise<LibraryState> {
  const [saved, savedScan] = await Promise.all([
    getMeta<LibraryState>(STATE_KEY),
    getMeta<LibraryScanData>(SCAN_KEY),
  ]);
  if (savedScan && Array.isArray(savedScan.items) && typeof savedScan.query === 'string') {
    lastScan = savedScan;
  }
  if (!saved || typeof saved !== 'object') {
    state = { ...EMPTY_STATE };
    return state;
  }
  state = {
    ...EMPTY_STATE,
    ...saved,
    errors: Array.isArray(saved.errors) ? saved.errors : [],
  };
  if (state.running) {
    state = {
      ...state,
      running: false,
      phase: 'error',
      message: 'The previous library operation was interrupted. Scan again to start over.',
      finishedAt: Date.now(),
    };
    await setMeta(STATE_KEY, state);
  }
  return state;
}

function ensureToken() {
  return getUsableAuthSession();
}

export async function scanLibrary(query: string): Promise<LibraryScanResult & { ok: boolean; error?: string }> {
  if (active) {
    return { ok: false, items: [], total: 0, error: 'A library operation is already running.' };
  }

  const controller = new AbortController();
  const runId = crypto.randomUUID();
  active = { id: runId, controller };

  const session = await ensureToken();
  if (!session) {
    active = null;
    return {
      ok: false,
      items: [],
      total: 0,
      error:
        'No ChatGPT session captured. Open chatgpt.com, sign in, and reload the page so c2n can observe the session token.',
    };
  }

  state = {
    ...EMPTY_STATE,
    running: true,
    phase: 'scanning',
    runId,
    query,
    startedAt: Date.now(),
    message: query.trim() ? `Scanning library for “${query.trim()}”…` : 'Scanning all library images…',
  };
  listener?.(state);
  await setMeta(STATE_KEY, state);

  try {
    const items: LibraryItem[] = [];
    const seenItems = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const data = await getLibraryImages(session.token, query, cursor, controller.signal);
      for (const item of data.items) {
        const key = item.id || `${item.fileId}:${item.name}`;
        if (!seenItems.has(key)) {
          seenItems.add(key);
          items.push(item);
        }
      }
      await update({
        total: items.length,
        message: `Found ${items.length} image${items.length === 1 ? '' : 's'}…`,
      });
      if (!data.items.length) {
        break;
      }
      cursor = data.cursor;
      if (!cursor || seenCursors.has(cursor)) {
        break;
      }
      seenCursors.add(cursor);
    }

    await saveLastScan({ query, items, scannedAt: Date.now() });
    active = null;
    await update({
      running: false,
      phase: 'idle',
      finishedAt: Date.now(),
      total: items.length,
      message: items.length
        ? `Found ${items.length} image${items.length === 1 ? '' : 's'}. Review the list before deleting.`
        : 'No matching images found.',
    });
    return { ok: true, items, total: items.length };
  } catch (error) {
    active = null;
    if (isAbortError(error)) {
      await update({
        running: false,
        phase: 'cancelled',
        finishedAt: Date.now(),
        message: 'Scan cancelled.',
      });
      return { ok: false, items: [], total: 0, error: 'Scan cancelled.' };
    }
    const message = errorMessage(error);
    await update({
      running: false,
      phase: 'error',
      finishedAt: Date.now(),
      message: `Scan failed: ${message}`,
      errors: [
        {
          id: 'scan',
          fileName: '—',
          stage: 'library_scan',
          message,
          at: new Date().toISOString(),
        },
      ],
    });
    return { ok: false, items: [], total: 0, error: message };
  }
}

export function cancelLibraryOperation(): boolean {
  if (!active) {
    return false;
  }
  active.controller.abort();
  void update({ message: 'Cancelling…' });
  return true;
}

export async function deleteScannedLibrary(): Promise<{ ok: boolean; error?: string }> {
  if (active) {
    return { ok: false, error: 'A library operation is already running.' };
  }
  const scan = lastScan;
  if (!scan) {
    return { ok: false, error: 'Scan the library before deleting anything.' };
  }
  if (!scan.items.length) {
    return { ok: false, error: 'There is nothing to delete. Scan again first.' };
  }

  const controller = new AbortController();
  const runId = crypto.randomUUID();
  active = { id: runId, controller };

  const session = await ensureToken();
  if (!session) {
    active = null;
    return {
      ok: false,
      error:
        'No ChatGPT session captured. Open chatgpt.com, sign in, and reload the page so c2n can observe the session token.',
    };
  }

  state = {
    ...state,
    running: true,
    phase: 'deleting',
    runId,
    query: scan.query,
    startedAt: Date.now(),
    finishedAt: null,
    total: scan.items.length,
    deleted: 0,
    failed: 0,
    errors: [],
    message: `Deleting ${scan.items.length} image${scan.items.length === 1 ? '' : 's'}…`,
  };
  listener?.(state);
  await setMeta(STATE_KEY, state);

  let cursor = 0;
  let deleted = 0;
  let failed = 0;
  let errors: RunError[] = [];

  const worker = async (): Promise<void> => {
    for (;;) {
      if (controller.signal.aborted) {
        return;
      }
      const index = cursor;
      cursor += 1;
      const item = scan.items[index];
      if (!item) {
        return;
      }
      try {
        await deleteLibraryFile(session.token, item, controller.signal);
        deleted += 1;
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        failed += 1;
        errors = [
          ...errors,
          {
            id: item.id,
            fileName: item.name,
            stage: 'library_delete' as const,
            message: errorMessage(error),
            at: new Date().toISOString(),
          },
        ].slice(-MAX_ERRORS);
      }
      await update({
        deleted,
        failed,
        errors,
        message: `Deleted ${deleted}${failed ? `, ${failed} failed` : ''} of ${scan.items.length}…`,
      });
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(DELETE_CONCURRENCY, scan.items.length) }, () => worker()),
    );
  } finally {
    active = null;
  }

  const finishedAt = Date.now();
  const cancelled = controller.signal.aborted;
  const phase = cancelled ? 'cancelled' : 'done';
  if (!cancelled && !failed) {
    await saveLastScan(null);
  }
  const message = cancelled
    ? `Deletion cancelled: ${deleted} deleted, ${failed} failed.`
    : `Deleted ${deleted} image${deleted === 1 ? '' : 's'}${failed ? `; ${failed} failed` : ''}.`;

  await update({
    running: false,
    phase,
    finishedAt,
    deleted,
    failed,
    errors,
    message,
  });

  const record: LibraryRunRecord = {
    id: runId,
    startedAt: state.startedAt ?? finishedAt,
    finishedAt,
    phase,
    query: scan.query,
    total: scan.items.length,
    deleted,
    failed,
    errors,
  };
  await saveLibraryRun(record);
  return { ok: true };
}

export async function clearLibraryScan(): Promise<void> {
  await saveLastScan(null);
}
