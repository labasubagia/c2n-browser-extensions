import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  clearAuthSession,
  getAuthStatus,
  saveObservedToken,
  setAuthEmail,
} from '@/lib/auth';
import { getMe } from '@/lib/chatgpt';
import {
  cancelLibraryOperation,
  clearLibraryScan,
  deleteScannedLibrary,
  getLastLibraryScan,
  getLibraryState,
  type LibraryScanData,
  restoreLibraryState,
  scanLibrary,
  setLibraryStateListener,
} from '@/lib/library';
import type {
  ExtensionMessage,
  RuntimeStatus,
  ScanResponse,
} from '@/lib/messages';
import { NotionClient } from '@/lib/notion';
import {
  isNotionConfigured,
  loadSettings,
  validateSettings,
} from '@/lib/settings';
import { getPendingCount, getRecentRuns } from '@/lib/storage';
import {
  cancelSync,
  getSyncState,
  restoreSyncState,
  setSyncStateListener,
  startSync,
} from '@/lib/sync';
import type { LibraryState, SyncState } from '@/lib/types';
import { errorMessage } from '@/lib/util';

let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let emailLookupToken: string | null = null;

function broadcastStates(sync: SyncState, library: LibraryState): void {
  void browser.runtime
    .sendMessage({
      type: 'STATE_UPDATE',
      sync,
      library,
    } satisfies ExtensionMessage)
    .catch(() => {
      // No UI is open; state is persisted and will be read on demand.
    });
  syncKeepAlive(sync.running || library.running);
}

function syncKeepAlive(shouldRun: boolean): void {
  if (shouldRun && !keepAliveTimer) {
    keepAliveTimer = setInterval(() => {
      void browser.runtime.getPlatformInfo().catch(() => {
        // Ignore; the next call will retry.
      });
    }, 20_000);
  } else if (!shouldRun && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

async function notify(title: string, message: string): Promise<void> {
  const settings = await loadSettings();
  if (!settings.notifyOnFinish) {
    return;
  }
  try {
    await browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title,
      message,
    });
  } catch {
    // Notifications are best-effort.
  }
}

async function maybeLookupEmail(token: string): Promise<void> {
  if (emailLookupToken === token) {
    return;
  }
  emailLookupToken = token;
  try {
    const email = await getMe(token, AbortSignal.timeout(15_000));
    if (email) {
      await setAuthEmail(email);
    }
  } catch {
    // The JWT often carries the email already; this is only a fallback.
  }
}

async function buildStatus(): Promise<RuntimeStatus> {
  const [settings, auth, pending, runs, scan] = await Promise.all([
    loadSettings(),
    getAuthStatus(),
    getPendingCount(),
    getRecentRuns(1),
    Promise.resolve(getLastLibraryScan()),
  ]);
  return {
    auth,
    settings,
    notionConfigured: isNotionConfigured(settings),
    pending,
    sync: getSyncState(),
    library: getLibraryState(),
    lastRun: runs[0],
    scan: scan
      ? {
          query: (scan as LibraryScanData).query,
          count: scan.items.length,
          scannedAt: scan.scannedAt,
        }
      : null,
    version: browser.runtime.getManifest().version,
  };
}

async function handleMessage(
  message: ExtensionMessage,
  sender: { tab?: { url?: string }; url?: string },
): Promise<unknown> {
  switch (message.type) {
    case 'AUTH_TOKEN_OBSERVED': {
      const url = sender.tab?.url ?? sender.url ?? '';
      if (!/^https:\/\/([a-z0-9-]+\.)*chatgpt\.com\//i.test(url)) {
        return { ok: false };
      }
      if (typeof message.token !== 'string') {
        return { ok: false };
      }
      const session = await saveObservedToken(message.token, message.userAgent);
      if (session && !session.email) {
        void maybeLookupEmail(session.token);
      }
      return { ok: Boolean(session) };
    }

    case 'GET_STATUS':
      return buildStatus();

    case 'START_SYNC': {
      if (getLibraryState().running) {
        return {
          ok: false,
          error: 'Wait for the library operation to finish before syncing.',
        };
      }
      const result = await startSync({ resume: Boolean(message.resume) });
      return result;
    }

    case 'CANCEL_SYNC':
      return { ok: cancelSync() };

    case 'TEST_NOTION': {
      const settings = await loadSettings();
      const errors = validateSettings(settings);
      if (errors.length) {
        return {
          ok: false,
          checks: errors.map((detail) => ({
            label: 'Settings',
            ok: false,
            detail,
          })),
          error: errors[0],
        };
      }
      const client = new NotionClient(
        settings.notion.apiKey,
        settings.notion.version,
      );
      return client.validateDatabase(
        settings.notion.databaseId,
        AbortSignal.timeout(30_000),
      );
    }

    case 'SCAN_LIBRARY': {
      if (getSyncState().running) {
        return {
          ok: false,
          items: [],
          total: 0,
          error:
            'Wait for the current sync to finish before scanning the library.',
        } satisfies ScanResponse;
      }
      const result: ScanResponse = await scanLibrary(message.query ?? '');
      broadcastStates(getSyncState(), getLibraryState());
      return result;
    }

    case 'DELETE_LIBRARY': {
      if (getSyncState().running) {
        return {
          ok: false,
          error:
            'Wait for the current sync to finish before deleting library images.',
        };
      }
      const result = await deleteScannedLibrary();
      broadcastStates(getSyncState(), getLibraryState());
      return result;
    }

    case 'CANCEL_LIBRARY':
      return { ok: cancelLibraryOperation() };

    case 'CLEAR_LIBRARY_SCAN':
      await clearLibraryScan();
      return { ok: true };

    case 'FORGET_AUTH':
      await clearAuthSession();
      emailLookupToken = null;
      return { ok: true };

    default:
      return { ok: false, error: 'Unknown message type.' };
  }
}

export default defineBackground(() => {
  setSyncStateListener((sync) => {
    broadcastStates(sync, getLibraryState());
    if (
      !sync.running &&
      (sync.phase === 'done' ||
        sync.phase === 'error' ||
        sync.phase === 'cancelled')
    ) {
      const title =
        sync.phase === 'done'
          ? 'c2n sync finished'
          : sync.phase === 'cancelled'
            ? 'c2n sync cancelled'
            : 'c2n sync failed';
      void notify(title, sync.message);
    }
  });
  setLibraryStateListener((library) => {
    broadcastStates(getSyncState(), library);
  });

  const ready = (async () => {
    await Promise.all([restoreSyncState(), restoreLibraryState()]);
    syncKeepAlive(false);
  })();

  browser.runtime.onMessage.addListener(
    (
      message: ExtensionMessage,
      sender: { tab?: { url?: string }; url?: string },
      sendResponse: (response: unknown) => void,
    ) => {
      if (
        !message ||
        typeof message !== 'object' ||
        typeof message.type !== 'string'
      ) {
        return false;
      }
      ready
        .then(() => handleMessage(message, sender))
        .then((response) => sendResponse(response))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: errorMessage(error) }),
        );
      return true;
    },
  );

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      void browser.runtime.openOptionsPage();
    }
  });
});
