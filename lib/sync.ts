import { getUsableAuthSession, setAuthEmail } from './auth';
import {
  downloadImage,
  getConversation,
  getMe,
  getPromptFromImageNodeInConversation,
  getRecentImageGenerations,
} from './chatgpt';
import { NotionClient } from './notion';
import { injectPromptMetadata } from './png';
import { HttpError } from './retry';
import { loadSettings, isNotionConfigured } from './settings';
import {
  getGenerationsByIds,
  getMeta,
  getPendingGenerations,
  markGenerationFailed,
  markGenerationUploaded,
  putGenerations,
  saveRun,
  setMeta,
} from './storage';
import type {
  GenerationRecord,
  RunError,
  RunErrorStage,
  SyncRunRecord,
  SyncState,
} from './types';
import { errorMessage, fileNameForGeneration, isAbortError, timestampToIso } from './util';

const STATE_KEY = 'syncState';
const MAX_ERRORS = 50;

const EMPTY_STATE: SyncState = {
  running: false,
  phase: 'idle',
  runId: null,
  startedAt: null,
  finishedAt: null,
  discovered: 0,
  total: 0,
  current: 0,
  uploaded: 0,
  skipped: 0,
  failed: 0,
  message: '',
  errors: [],
};

let state: SyncState = { ...EMPTY_STATE };
let active: { id: string; controller: AbortController } | null = null;
let starting = false;
let listener: ((state: SyncState) => void) | null = null;

export function setSyncStateListener(next: ((state: SyncState) => void) | null): void {
  listener = next;
}

export function getSyncState(): SyncState {
  return state;
}

export function isSyncRunning(): boolean {
  return state.running;
}

async function update(patch: Partial<SyncState>): Promise<SyncState> {
  state = { ...state, ...patch };
  if (state.errors.length > MAX_ERRORS) {
    state = { ...state, errors: state.errors.slice(-MAX_ERRORS) };
  }
  listener?.(state);
  await setMeta(STATE_KEY, state);
  return state;
}

function appendError(errors: RunError[], error: RunError): RunError[] {
  return [...errors, error].slice(-MAX_ERRORS);
}

/**
 * Called once when the service worker starts. A persisted `running` state means
 * the worker was suspended (or the browser closed) mid-run, so surface an
 * interrupted run the user can resume.
 */
export async function restoreSyncState(): Promise<SyncState> {
  const saved = await getMeta<SyncState>(STATE_KEY);
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
      phase: 'interrupted',
      message: 'The previous sync was interrupted. Resume it to continue where it stopped.',
      finishedAt: Date.now(),
    };
    await setMeta(STATE_KEY, state);
  }
  return state;
}

export interface StartSyncResult {
  ok: boolean;
  error?: string;
}

export async function startSync(options: { resume?: boolean } = {}): Promise<StartSyncResult> {
  if (active || starting) {
    return { ok: false, error: 'A sync is already running.' };
  }
  starting = true;
  try {
    const settings = await loadSettings();
    if (!isNotionConfigured(settings)) {
      return {
        ok: false,
        error: 'Configure your Notion integration token and database ID in Settings first.',
      };
    }

    const session = await getUsableAuthSession();
    if (!session) {
      return {
        ok: false,
        error:
          'No ChatGPT session captured. Open chatgpt.com, sign in, and reload the page so c2n can observe the session token.',
      };
    }

    const runId = crypto.randomUUID();
    const controller = new AbortController();
    active = { id: runId, controller };
    const startedAt = Date.now();
    const baseState: SyncState = {
      ...EMPTY_STATE,
      running: true,
      phase: 'discovering',
      runId,
      startedAt,
      message: options.resume ? 'Resuming…' : 'Looking for recent image generations…',
    };
    state = baseState;
    listener?.(state);
    await setMeta(STATE_KEY, state);

    void run(runId, session, settings, controller.signal, Boolean(options.resume)).catch(
      async (error: unknown) => {
        if (active?.id !== runId) {
          return;
        }
        await finishWithError(error);
      },
    );

    return { ok: true };
  } finally {
    starting = false;
  }
}

export function cancelSync(): boolean {
  if (!active) {
    return false;
  }
  active.controller.abort();
  void update({ message: 'Cancelling…' });
  return true;
}

async function run(
  runId: string,
  session: { token: string; email?: string },
  settings: Awaited<ReturnType<typeof loadSettings>>,
  signal: AbortSignal,
  resume: boolean,
): Promise<void> {
  const notion = new NotionClient(settings.notion.apiKey, settings.notion.version);
  let runErrors: RunError[] = [];
  let email = session.email;

  try {
    const validation = await notion.validateDatabase(settings.notion.databaseId, signal);
    if (!validation.ok) {
      throw new Error(validation.error ?? 'Notion database validation failed.');
    }

    if (!email) {
      try {
        email = await getMe(session.token, signal);
        if (email) {
          await setAuthEmail(email);
        }
      } catch {
        // Email is only used as extra page metadata; ignore failures.
      }
    }

    const items = await getRecentImageGenerations(
      session.token,
      Math.max(settings.sync.limit, 1),
      signal,
    );
    ensureActive(runId);

    const known = await getGenerationsByIds(items.map((item) => item.id));
    const knownById = new Map(known.map((record) => [record.id, record]));

    // Signed image URLs expire between runs; refresh them for retries while
    // keeping the original filename so Notion deduplication stays stable.
    const refreshed: GenerationRecord[] = [];
    for (const item of items) {
      const existing = knownById.get(item.id);
      if (existing && existing.status !== 'uploaded' && existing.url !== item.url) {
        const next = { ...existing, url: item.url };
        knownById.set(item.id, next);
        refreshed.push(next);
      }
    }
    await putGenerations(refreshed);

    const byConversation = new Map<string, typeof items>();
    for (const item of items) {
      const bucket = byConversation.get(item.conversationId) ?? [];
      bucket.push(item);
      byConversation.set(item.conversationId, bucket);
    }

    let discovered = 0;
    for (const [conversationId, conversationItems] of byConversation) {
      const missing = conversationItems.filter((item) => !knownById.has(item.id));
      if (!missing.length) {
        continue;
      }
      const details = await getConversation(session.token, conversationId, signal);
      ensureActive(runId);
      const records: GenerationRecord[] = missing.map((item) => {
        const prompt =
          getPromptFromImageNodeInConversation(details, item.messageId, item.assetPointer) ?? '';
        return {
          id: item.id,
          conversationId,
          messageId: item.messageId,
          assetPointer: item.assetPointer,
          url: item.url,
          prompt,
          createdAt: timestampToIso(item.createdAt),
          fileName: fileNameForGeneration(item.id, item.url),
          status: 'pending',
          attempts: 0,
        };
      });
      await putGenerations(records);
      discovered += records.length;
    }

    const recentIds = new Set(items.map((item) => item.id));
    const pending = await getPendingGenerations(500);
    const candidates = resume
      ? [...pending]
      : pending
          .filter((record) => recentIds.has(record.id) || record.status === 'failed')
          .sort((left, right) => {
            const leftRecent = recentIds.has(left.id) ? 0 : 1;
            const rightRecent = recentIds.has(right.id) ? 0 : 1;
            return leftRecent - rightRecent || left.createdAt.localeCompare(right.createdAt);
          });
    const selected = candidates.slice(0, settings.sync.limit);

    await update({
      phase: 'processing',
      discovered: discovered,
      total: selected.length,
      current: 0,
      uploaded: 0,
      skipped: 0,
      failed: 0,
      message: selected.length
        ? `Processing ${selected.length} generation${selected.length === 1 ? '' : 's'}…`
        : 'No new image generations to sync.',
      errors: [],
    });

    if (!selected.length) {
      await finish(runId, 'done', email, runErrors, 'Nothing to sync. Recent images are already up to date.');
      return;
    }

    for (const record of selected) {
      ensureActive(runId);
      const result = await processOne(
        record,
        session.token,
        notion,
        settings,
        signal,
        email,
      );
      ensureActive(runId);

      if (result.outcome === 'uploaded') {
        await update({
          current: state.current + 1,
          uploaded: state.uploaded + 1,
          message: `Uploaded ${result.fileName}`,
        });
      } else if (result.outcome === 'skipped') {
        await update({
          current: state.current + 1,
          skipped: state.skipped + 1,
          message: `Skipped ${result.fileName} (already in Notion)`,
        });
      } else {
        const error: RunError = {
          id: record.id,
          fileName: result.fileName,
          stage: result.stage ?? 'upload',
          message: result.error ?? 'Unknown error',
          at: new Date().toISOString(),
        };
        runErrors = appendError(runErrors, error);
        await markGenerationFailed(record.id, error.message);
        await update({
          current: state.current + 1,
          failed: state.failed + 1,
          errors: runErrors,
          message: `Failed ${result.fileName}: ${error.message}`,
        });
      }
    }

    await finish(
      runId,
      'done',
      email,
      runErrors,
      `Sync finished: ${state.uploaded} uploaded, ${state.skipped} skipped, ${state.failed} failed.`,
    );
  } catch (error) {
    if (active?.id !== runId) {
      return;
    }
    if (signal.aborted || isAbortError(error)) {
      await finish(
        runId,
        'cancelled',
        email,
        runErrors,
        `Sync cancelled after ${state.current} of ${state.total} generation${state.total === 1 ? '' : 's'}.`,
      );
      return;
    }
    await finishWithError(error, email);
  }
}

function ensureActive(runId: string): void {
  if (active?.id !== runId) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

async function finishWithError(error: unknown, email?: string): Promise<void> {
  const message = errorMessage(error);
  const runId = state.runId;
  const runErrors = appendError(state.errors, {
    id: 'run',
    fileName: '—',
    stage: 'run',
    message,
    at: new Date().toISOString(),
  });
  await update({ errors: runErrors });
  await finish(runId, 'error', email, runErrors, `Sync failed: ${message}`);
}

async function finish(
  runId: string | null,
  phase: SyncState['phase'],
  email: string | undefined,
  errors: RunError[],
  message: string,
): Promise<void> {
  const finishedAt = Date.now();
  active = null;
  await update({
    running: false,
    phase,
    finishedAt,
    message,
    errors,
  });
  if (runId && state.startedAt) {
    const record: SyncRunRecord = {
      id: runId,
      startedAt: state.startedAt,
      finishedAt,
      phase,
      discovered: state.discovered,
      uploaded: state.uploaded,
      skipped: state.skipped,
      failed: state.failed,
      errors,
      email,
    };
    await saveRun(record);
  }
}

interface ProcessResult {
  outcome: 'uploaded' | 'skipped' | 'failed';
  fileName: string;
  stage?: RunErrorStage;
  error?: string;
}

/**
 * A 401/403 means the whole run cannot succeed, so stop instead of marking every
 * remaining generation as failed.
 */
function fatalAuthMessage(error: unknown): string | null {
  if (!(error instanceof HttpError) || (error.status !== 401 && error.status !== 403)) {
    return null;
  }
  return error.url.includes('notion.com')
    ? 'Notion rejected the request. Check the integration token and that the database is shared with the integration.'
    : 'ChatGPT rejected the request. Reload chatgpt.com so c2n can capture a fresh session token.';
}

async function processOne(
  record: GenerationRecord,
  token: string,
  notion: NotionClient,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  signal: AbortSignal,
  email: string | undefined,
): Promise<ProcessResult> {
  const fileName = record.fileName || fileNameForGeneration(record.id, record.url);

  if (record.status === 'uploaded') {
    return { outcome: 'skipped', fileName };
  }

  if (settings.sync.checkNotionDuplicates) {
    try {
      const exists = await notion.isPageExists(settings.notion.databaseId, fileName, signal);
      if (exists) {
        await markGenerationUploaded(record.id);
        return { outcome: 'skipped', fileName };
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        throw error;
      }
      const fatal = fatalAuthMessage(error);
      if (fatal) {
        throw new Error(fatal);
      }
      return {
        outcome: 'failed',
        fileName,
        stage: 'notion_check',
        error: errorMessage(error),
      };
    }
  }

  let blob: Blob;
  try {
    blob = await downloadImage(token, record.url, signal);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      throw error;
    }
    const fatal = fatalAuthMessage(error);
    if (fatal) {
      throw new Error(fatal);
    }
    return { outcome: 'failed', fileName, stage: 'download', error: errorMessage(error) };
  }

  if (settings.sync.embedPromptMetadata && record.prompt) {
    try {
      blob = (await injectPromptMetadata(blob, record.prompt)).blob;
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        throw error;
      }
      return { outcome: 'failed', fileName, stage: 'prompt', error: errorMessage(error) };
    }
  }

  try {
    await notion.addPageToDatabase(
      settings.notion.databaseId,
      fileName,
      blob,
      record.prompt,
      email,
      signal,
    );
    await markGenerationUploaded(record.id);
    return { outcome: 'uploaded', fileName };
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      throw error;
    }
    const fatal = fatalAuthMessage(error);
    if (fatal) {
      throw new Error(fatal);
    }
    return { outcome: 'failed', fileName, stage: 'upload', error: errorMessage(error) };
  }
}
