import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  isStateUpdate,
  openOptionsPage,
  openPage,
  type RuntimeStatus,
  sendMessage,
} from '@/lib/messages';
import { shouldRedirectToChatGPT } from '@/lib/popup-redirect';
import { loadSettings, saveSettings } from '@/lib/settings';
import type { SyncState } from '@/lib/types';
import { errorMessage } from '@/lib/util';

function formatDateTime(value: number | undefined): string {
  if (!value) {
    return 'unknown';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function phaseLabel(sync: SyncState): string {
  switch (sync.phase) {
    case 'discovering':
      return 'Discovering image generations';
    case 'processing':
      return 'Uploading to Notion';
    case 'done':
      return 'Finished';
    case 'error':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'interrupted':
      return 'Interrupted';
    default:
      return 'Idle';
  }
}

function errorStage(stage: string): string {
  switch (stage) {
    case 'notion_check':
      return 'Notion check';
    case 'download':
      return 'Download';
    case 'prompt':
      return 'PNG metadata';
    case 'upload':
      return 'Upload';
    case 'run':
      return 'Run';
    default:
      return stage;
  }
}

export default function App() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteConvs, setDeleteConvs] = useState<boolean>(false);
  const [convsLoaded, setConvsLoaded] = useState(false);
  const toggleDeleteConvs = async (checked: boolean) => {
    setDeleteConvs(checked);
    const current = await loadSettings();
    await saveSettings({
      ...current,
      sync: { ...current.sync, deleteConversationsAfterSync: checked },
    });
  };

  const refresh = useCallback(async () => {
    try {
      const next = await sendMessage({ type: 'GET_STATUS' });
      setStatus(next);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, []);
  const redirectStarted = useRef(false);
  useEffect(() => {
    if (redirectStarted.current) return;
    redirectStarted.current = true;
    void (async () => {
      try {
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!shouldRedirectToChatGPT(tab?.url)) {
          return;
        }
        const [existing] = await browser.tabs.query({
          url: ['https://chatgpt.com/*', 'https://*.chatgpt.com/*'],
        });
        if (existing?.id != null) {
          await browser.tabs.update(existing.id, { active: true });
          if (existing.windowId != null) {
            await browser.windows.update(existing.windowId, { focused: true });
          }
        } else {
          await browser.tabs.create({ url: 'https://chatgpt.com/' });
        }
        window.close();
      } catch {
        // popup stays open on failure; effect runs once, no retry
      }
    })();
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 4_000);
    const listener = (message: unknown) => {
      if (isStateUpdate(message)) {
        setStatus((current) =>
          current
            ? { ...current, sync: message.sync, library: message.library }
            : current,
        );
      }
      return false;
    };
    browser.runtime.onMessage.addListener(listener);
    return () => {
      window.clearInterval(timer);
      browser.runtime.onMessage.removeListener(listener);
    };
  }, [refresh]);
  useEffect(() => {
    if (status && !convsLoaded) {
      setDeleteConvs(status.settings.sync.deleteConversationsAfterSync);
      setConvsLoaded(true);
    }
  }, [status, convsLoaded]);

  const start = async (resume: boolean) => {
    setBusy(resume ? 'resume' : 'sync');
    setError(null);
    setNotice(null);
    try {
      const result = await sendMessage({ type: 'START_SYNC', resume });
      if (!result.ok) {
        setError(result.error ?? 'Could not start the sync.');
      }
      await refresh();
    } catch (startError) {
      setError(errorMessage(startError));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    try {
      await sendMessage({ type: 'CANCEL_SYNC' });
      await refresh();
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    } finally {
      setBusy(null);
    }
  };

  const openChatGpt = () => {
    void browser.tabs.create({ url: 'https://chatgpt.com/' });
  };

  if (!status) {
    return (
      <div className="app">
        <Brand />
        <div className="card muted small">{error ?? 'Loading…'}</div>
      </div>
    );
  }

  const running = status.sync.running;
  const interrupted = status.sync.phase === 'interrupted';
  const configured = status.notionConfigured;
  const authOk = status.auth.present;
  const libraryRunning = status.library.running;
  const progress = status.sync.total
    ? Math.min(100, Math.round((status.sync.current / status.sync.total) * 100))
    : 0;
  const errors = status.sync.errors.slice(-4);
  const githubUrl = (
    import.meta.env as Record<string, string | undefined>
  ).WXT_GITHUB_URL?.trim();

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <Brand />
        <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-surface-muted text-muted border-edge">
          v{status.version}
        </span>
      </div>

      {!authOk && (
        <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-warning-soft text-ink border-[color-mix(in_srgb,var(--warning)_30%,transparent)] flex flex-col gap-1.5">
          <strong>
            {status.auth.capturedAt
              ? 'ChatGPT session expired'
              : 'Waiting for a ChatGPT session'}
          </strong>
          <span>
            {status.auth.capturedAt
              ? 'Reload chatgpt.com to let c2n observe a fresh token from ChatGPT’s own requests.'
              : 'Open chatgpt.com, sign in, and reload the page. c2n observes the token ChatGPT already sends — there is no separate login.'}
          </span>
          <div>
            <button
              className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-2 py-1 text-[11.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-surface text-ink border-edge enabled:hover:bg-surface-muted"
              onClick={openChatGpt}
              type="button"
            >
              Open ChatGPT
            </button>
          </div>
        </div>
      )}

      {!configured && (
        <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-accent-soft text-ink border-[color-mix(in_srgb,var(--accent)_25%,transparent)] flex items-center gap-2 flex-wrap justify-between">
          <span>Notion is not configured yet.</span>
          <button
            className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-2 py-1 text-[11.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-surface text-ink border-edge enabled:hover:bg-surface-muted"
            onClick={openOptionsPage}
            type="button"
          >
            Settings
          </button>
        </div>
      )}

      {libraryRunning && (
        <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-warning-soft text-ink border-[color-mix(in_srgb,var(--warning)_30%,transparent)]">
          Library cleanup is running. Syncing is locked until it finishes.
        </div>
      )}

      {error && (
        <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-danger-soft text-ink border-[color-mix(in_srgb,var(--danger)_30%,transparent)]">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-accent-soft text-ink border-[color-mix(in_srgb,var(--accent)_25%,transparent)]">
          {notice}
        </div>
      )}

      <section className="bg-surface border border-edge rounded-xl p-3.5 shadow-[var(--shadow)] flex flex-col gap-2.5">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-[13px] font-semibold tracking-[0.01em]">
            Sync
          </span>
          <span className="flex-1" />
          <span
            className={
              running
                ? 'inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-accent-soft text-success border-[color-mix(in_srgb,var(--success)_25%,transparent)]'
                : status.sync.failed
                  ? 'inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-warning-soft text-warning border-[color-mix(in_srgb,var(--warning)_25%,transparent)]'
                  : 'inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-surface-muted text-muted border-edge'
            }
          >
            {running ? 'Running' : phaseLabel(status.sync)}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-between text-xs">
          <span className="text-muted">
            {status.pending} generation{status.pending === 1 ? '' : 's'} waiting
          </span>
          <span className="text-muted">Limit {status.settings.sync.limit}</span>
        </div>

        {interrupted && (
          <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-warning-soft text-ink border-[color-mix(in_srgb,var(--warning)_30%,transparent)] flex flex-col gap-1.5">
            <strong>A previous run was interrupted</strong>
            <span>
              Resume continues from the saved checkpoint. Already-uploaded
              images are skipped.
            </span>
            <div>
              <button
                className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-2 py-1 text-[11.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-accent text-white dark:text-[#10201c] border-accent enabled:hover:bg-accent-strong enabled:hover:border-accent-strong"
                disabled={
                  Boolean(busy) || !authOk || !configured || libraryRunning
                }
                onClick={() => void start(true)}
                type="button"
              >
                {busy === 'resume' ? 'Resuming…' : 'Resume interrupted run'}
              </button>
            </div>
          </div>
        )}

        {(running || status.sync.total > 0) && (
          <div className="flex flex-col gap-1.5">
            <div
              className="h-[7px] rounded-full bg-surface-muted overflow-hidden border border-edge"
              aria-hidden="true"
            >
              <div
                className="h-full bg-accent rounded-full transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-between text-xs text-muted">
              <span>
                {status.sync.current} / {status.sync.total || '—'} processed
              </span>
              <span>{progress}%</span>
            </div>
          </div>
        )}

        <p className="text-xs text-muted" style={{ overflowWrap: 'anywhere' }}>
          {status.sync.message ||
            'Sync runs only when you ask. Nothing is uploaded automatically.'}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-surface-muted border border-edge rounded-lg px-2.25 py-1.75">
            <div className="text-base font-semibold leading-[1.1] tabular-nums">
              {status.sync.uploaded}
            </div>
            <div className="text-[10.5px] text-muted uppercase tracking-[0.06em] mt-0.5">
              Uploaded
            </div>
          </div>
          <div className="bg-surface-muted border border-edge rounded-lg px-2.25 py-1.75">
            <div className="text-base font-semibold leading-[1.1] tabular-nums">
              {status.sync.skipped}
            </div>
            <div className="text-[10.5px] text-muted uppercase tracking-[0.06em] mt-0.5">
              Skipped
            </div>
          </div>
          <div className="bg-surface-muted border border-edge rounded-lg px-2.25 py-1.75">
            <div className="text-base font-semibold leading-[1.1] tabular-nums">
              {status.sync.failed}
            </div>
            <div className="text-[10.5px] text-muted uppercase tracking-[0.06em] mt-0.5">
              Failed
            </div>
          </div>
          <div className="bg-surface-muted border border-edge rounded-lg px-2.25 py-1.75">
            <div className="text-base font-semibold leading-[1.1] tabular-nums">
              {status.sync.deleted}
            </div>
            <div className="text-[10.5px] text-muted uppercase tracking-[0.06em] mt-0.5">
              Conversations deleted
            </div>
          </div>
        </div>

        {errors.length > 0 && (
          <ul className="flex flex-col gap-1.5 max-h-40 overflow-auto list-none m-0 p-0">
            {errors.map((entry, _index) => (
              <li key={entry.id}>
                <span className="inline-block mr-1.5 px-1 rounded font-mono text-[10px] uppercase bg-[color-mix(in_srgb,currentColor_12%,transparent)]">
                  {errorStage(entry.stage)}
                </span>
                {entry.fileName !== '—' ? `${entry.fileName}: ` : ''}
                {entry.message}
              </li>
            ))}
          </ul>
        )}

        {!running && (
          <label className="flex items-start gap-2.25 py-2 border-t border-edge first:border-t-0 first:pt-0">
            <input
              type="checkbox"
              className="mt-0.5 accent-accent"
              checked={deleteConvs}
              disabled={Boolean(busy) || libraryRunning}
              onChange={(event) => void toggleDeleteConvs(event.target.checked)}
            />
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[12.5px] font-semibold">
                Delete conversations after sync
              </span>
              <span className="text-[11.5px] text-muted">
                Once every image in a conversation has been uploaded or was
                already in Notion, deletes the whole conversation from ChatGPT.
                Any failed upload keeps it.
              </span>
            </span>
          </label>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {running ? (
            <button
              className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-3 py-1.75 text-[12.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed w-full bg-danger text-white border-danger enabled:hover:brightness-110"
              disabled={busy === 'cancel'}
              onClick={() => void cancel()}
              type="button"
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel sync'}
            </button>
          ) : (
            <button
              className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-3 py-1.75 text-[12.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed w-full bg-accent text-white dark:text-[#10201c] border-accent enabled:hover:bg-accent-strong enabled:hover:border-accent-strong"
              disabled={
                Boolean(busy) || !authOk || !configured || libraryRunning
              }
              onClick={() => void start(false)}
              type="button"
            >
              {busy === 'sync' ? 'Starting…' : 'Sync now'}
            </button>
          )}
        </div>
      </section>

      <section className="bg-surface border border-edge rounded-xl p-3.5 shadow-[var(--shadow)] flex flex-col gap-1.5">
        <div
          className="flex items-center gap-2 mb-2.5"
          style={{ marginBottom: 2 }}
        >
          <span className="text-[13px] font-semibold tracking-[0.01em]">
            Accounts
          </span>
          <span className="flex-1" />
          <button
            className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-2 py-1 text-[11.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-transparent text-muted border-transparent enabled:hover:bg-surface-muted enabled:hover:text-ink"
            onClick={openOptionsPage}
            type="button"
          >
            Settings
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-between text-xs">
          <span>ChatGPT</span>
          {authOk ? (
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-accent-soft text-success border-[color-mix(in_srgb,var(--success)_25%,transparent)]">
              {status.auth.email ?? 'Session captured'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-danger-soft text-danger border-[color-mix(in_srgb,var(--danger)_25%,transparent)]">
              No token
            </span>
          )}
        </div>
        {authOk && (
          <div className="text-xs text-muted">
            Token refreshed {formatDateTime(status.auth.lastSeenAt)}
            {status.auth.expiresAt
              ? ` · expires ${formatDateTime(status.auth.expiresAt)}`
              : ''}
          </div>
        )}
        <div className="h-px bg-edge my-0.5" />
        <div className="flex items-center gap-2 flex-wrap justify-between text-xs">
          <span>Notion</span>
          {configured ? (
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-accent-soft text-success border-[color-mix(in_srgb,var(--success)_25%,transparent)]">
              DB {status.settings.notion.databaseId.slice(0, 8)}…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-danger-soft text-danger border-[color-mix(in_srgb,var(--danger)_25%,transparent)]">
              Not configured
            </span>
          )}
        </div>
      </section>

      {status.lastRun && !running && (
        <div className="text-xs text-muted">
          Last run {formatDateTime(status.lastRun.finishedAt)}:{' '}
          {status.lastRun.uploaded} uploaded, {status.lastRun.skipped} skipped,{' '}
          {status.lastRun.failed} failed
          {status.lastRun.deleted
            ? `, ${status.lastRun.deleted} conversation${status.lastRun.deleted === 1 ? '' : 's'} deleted`
            : ''}
          .
        </div>
      )}

      <div className="flex items-center gap-2.5 pt-0.5 text-muted text-[11.5px]">
        <button
          className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-2 py-1 text-[11.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-transparent text-muted border-transparent enabled:hover:bg-surface-muted enabled:hover:text-ink"
          onClick={() => openPage('library.html')}
          type="button"
        >
          Library cleanup
        </button>
        <span className="flex-1" />
        {githubUrl && (
          <a href={githubUrl} target="_blank" rel="noreferrer">
            Github
          </a>
        )}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid place-items-center size-[34px] rounded-[10px] bg-accent text-bg font-bold text-[13px] tracking-[0.02em]">
        c2n
      </div>
      <div>
        <div className="text-base font-semibold leading-tight">
          ChatGPT → Notion
        </div>
        <div className="text-muted text-xs">Manual image sync</div>
      </div>
    </div>
  );
}
