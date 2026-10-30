import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { isStateUpdate, openOptionsPage, openPage, sendMessage, type RuntimeStatus } from '@/lib/messages';
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

  const refresh = useCallback(async () => {
    try {
      const next = await sendMessage({ type: 'GET_STATUS' });
      setStatus(next);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 4_000);
    const listener = (message: unknown) => {
      if (isStateUpdate(message)) {
        setStatus((current) =>
          current ? { ...current, sync: message.sync, library: message.library } : current,
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

  return (
    <div className="app">
      <div className="row row--between">
        <Brand />
        <span className="badge badge--neutral">v{status.version}</span>
      </div>

      {!authOk && (
        <div className="banner banner--warn stack stack--tight">
          <strong>
            {status.auth.capturedAt ? 'ChatGPT session expired' : 'Waiting for a ChatGPT session'}
          </strong>
          <span>
            {status.auth.capturedAt
              ? 'Reload chatgpt.com to let c2n observe a fresh token from ChatGPT’s own requests.'
              : 'Open chatgpt.com, sign in, and reload the page. c2n observes the token ChatGPT already sends — there is no separate login.'}
          </span>
          <div>
            <button className="btn btn--sm" onClick={openChatGpt} type="button">
              Open ChatGPT
            </button>
          </div>
        </div>
      )}

      {!configured && (
        <div className="banner banner--info row row--between">
          <span>Notion is not configured yet.</span>
          <button className="btn btn--sm" onClick={openOptionsPage} type="button">
            Settings
          </button>
        </div>
      )}

      {libraryRunning && (
        <div className="banner banner--warn">
          Library cleanup is running. Syncing is locked until it finishes.
        </div>
      )}

      {error && <div className="banner banner--danger">{error}</div>}
      {notice && <div className="banner banner--info">{notice}</div>}

      <section className="card stack">
        <div className="card__head">
          <span className="card__title">Sync</span>
          <span className="spacer" />
          <span
            className={
              running
                ? 'badge badge--ok'
                : status.sync.failed
                  ? 'badge badge--warn'
                  : 'badge badge--neutral'
            }
          >
            {running ? 'Running' : phaseLabel(status.sync)}
          </span>
        </div>

        <div className="row row--between small">
          <span className="muted">
            {status.pending} generation{status.pending === 1 ? '' : 's'} waiting
          </span>
          <span className="muted">Limit {status.settings.sync.limit}</span>
        </div>

        {interrupted && (
          <div className="banner banner--warn stack stack--tight">
            <strong>A previous run was interrupted</strong>
            <span>
              Resume continues from the saved checkpoint. Already-uploaded images are skipped.
            </span>
            <div>
              <button
                className="btn btn--primary btn--sm"
                disabled={Boolean(busy) || !authOk || !configured || libraryRunning}
                onClick={() => void start(true)}
                type="button"
              >
                {busy === 'resume' ? 'Resuming…' : 'Resume interrupted run'}
              </button>
            </div>
          </div>
        )}

        {(running || status.sync.total > 0) && (
          <div className="stack stack--tight">
            <div className="progress" aria-hidden="true">
              <div className="progress__bar" style={{ width: `${progress}%` }} />
            </div>
            <div className="row row--between small muted">
              <span>
                {status.sync.current} / {status.sync.total || '—'} processed
              </span>
              <span>{progress}%</span>
            </div>
          </div>
        )}

        <p className="small muted" style={{ overflowWrap: 'anywhere' }}>
          {status.sync.message || 'Sync runs only when you ask. Nothing is uploaded automatically.'}
        </p>

        <div className="stats">
          <div className="stat">
            <div className="stat__value">{status.sync.uploaded}</div>
            <div className="stat__label">Uploaded</div>
          </div>
          <div className="stat">
            <div className="stat__value">{status.sync.skipped}</div>
            <div className="stat__label">Skipped</div>
          </div>
          <div className="stat">
            <div className="stat__value">{status.sync.failed}</div>
            <div className="stat__label">Failed</div>
          </div>
        </div>

        {errors.length > 0 && (
          <ul className="error-list">
            {errors.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <span className="stage-tag">{errorStage(entry.stage)}</span>
                {entry.fileName !== '—' ? `${entry.fileName}: ` : ''}
                {entry.message}
              </li>
            ))}
          </ul>
        )}

        <div className="row">
          {running ? (
            <button
              className="btn btn--danger btn--wide"
              disabled={busy === 'cancel'}
              onClick={() => void cancel()}
              type="button"
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel sync'}
            </button>
          ) : (
            <button
              className="btn btn--primary btn--wide"
              disabled={Boolean(busy) || !authOk || !configured || libraryRunning}
              onClick={() => void start(false)}
              type="button"
            >
              {busy === 'sync' ? 'Starting…' : 'Sync now'}
            </button>
          )}
        </div>
      </section>

      <section className="card stack stack--tight">
        <div className="card__head" style={{ marginBottom: 2 }}>
          <span className="card__title">Accounts</span>
          <span className="spacer" />
          <button className="btn btn--ghost btn--sm" onClick={openOptionsPage} type="button">
            Settings
          </button>
        </div>
        <div className="row row--between small">
          <span>ChatGPT</span>
          {authOk ? (
            <span className="badge badge--ok">{status.auth.email ?? 'Session captured'}</span>
          ) : (
            <span className="badge badge--bad">No token</span>
          )}
        </div>
        {authOk && (
          <div className="small muted">
            Token refreshed {formatDateTime(status.auth.lastSeenAt)}
            {status.auth.expiresAt ? ` · expires ${formatDateTime(status.auth.expiresAt)}` : ''}
          </div>
        )}
        <div className="divider" />
        <div className="row row--between small">
          <span>Notion</span>
          {configured ? (
            <span className="badge badge--ok">
              DB {status.settings.notion.databaseId.slice(0, 8)}…
            </span>
          ) : (
            <span className="badge badge--bad">Not configured</span>
          )}
        </div>
      </section>

      {status.lastRun && !running && (
        <div className="small muted">
          Last run {formatDateTime(status.lastRun.finishedAt)}: {status.lastRun.uploaded} uploaded,{' '}
          {status.lastRun.skipped} skipped, {status.lastRun.failed} failed.
        </div>
      )}

      <div className="footer">
        <button className="btn btn--ghost btn--sm" onClick={() => openPage('library.html')} type="button">
          Library cleanup
        </button>
        <span className="spacer" />
        <a href="https://github.com/labasubagia/c2n" target="_blank" rel="noreferrer">
          c2n
        </a>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <div className="brand__mark">c2n</div>
      <div>
        <div className="brand__title">ChatGPT → Notion</div>
        <div className="brand__subtitle">Manual image sync</div>
      </div>
    </div>
  );
}
