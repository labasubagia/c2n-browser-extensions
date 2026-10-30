import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  isStateUpdate,
  openOptionsPage,
  type RuntimeStatus,
  sendMessage,
} from '@/lib/messages';
import type { LibraryItem } from '@/lib/types';
import { errorMessage } from '@/lib/util';

const PREVIEW_LIMIT = 200;

export default function App() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [scannedQuery, setScannedQuery] = useState('');
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<RuntimeStatus | null> => {
    try {
      const next = await sendMessage({ type: 'GET_STATUS' });
      setStatus(next);
      return next;
    } catch (loadError) {
      setError(errorMessage(loadError));
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 3_000);
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

  const library = status?.library;
  const scanning = library?.running ?? false;
  const syncRunning = status?.sync.running ?? false;
  const expected = useMemo(
    () => (scannedQuery.trim() ? 'DELETE' : 'DELETE ALL'),
    [scannedQuery],
  );
  const confirmationMatches =
    confirmation.trim() === expected && items.length > 0;
  const progress = library?.total
    ? Math.min(100, Math.round((library.deleted / library.total) * 100))
    : 0;

  const scan = async () => {
    setBusy('scan');
    setError(null);
    setNotice(null);
    setItems([]);
    setConfirmation('');
    try {
      const result = await sendMessage({ type: 'SCAN_LIBRARY', query });
      if (!result.ok) {
        setError(result.error ?? 'Scan failed.');
      } else {
        setItems(result.items);
        setScannedQuery(query);
        setScannedAt(Date.now());
        setNotice(
          result.total
            ? `Found ${result.total} image${result.total === 1 ? '' : 's'}. Review the list, then type the confirmation to delete.`
            : 'No matching library images were found.',
        );
      }
      await refresh();
    } catch (scanError) {
      setError(errorMessage(scanError));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirmationMatches) {
      return;
    }
    setBusy('delete');
    setError(null);
    setNotice(null);
    try {
      const result = await sendMessage({ type: 'DELETE_LIBRARY' });
      const latest = await refresh();
      if (!result.ok) {
        setError(result.error ?? 'Delete failed.');
      } else if (
        latest &&
        (latest.library.failed > 0 || latest.library.phase === 'cancelled')
      ) {
        setConfirmation('');
        setNotice(
          latest.library.phase === 'cancelled'
            ? `Deletion cancelled after ${latest.library.deleted} deletes${latest.library.failed ? ` (${latest.library.failed} failed)` : ''}. Retry or rescan when ready.`
            : `Deleted ${latest.library.deleted} image(s); ${latest.library.failed} failed. You can retry or rescan — repeated deletes are safe.`,
        );
      } else {
        setItems([]);
        setConfirmation('');
        setNotice(
          'Deletion finished. Check the counters below for any failures.',
        );
      }
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    try {
      await sendMessage({ type: 'CANCEL_LIBRARY' });
      await refresh();
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    } finally {
      setBusy(null);
    }
  };

  const visibleItems = items.slice(0, PREVIEW_LIMIT);

  return (
    <div className="app app--page">
      <header className="stack">
        <div className="row row--between">
          <div className="brand">
            <div className="brand__mark">c2n</div>
            <div>
              <div className="brand__title">Library cleanup</div>
              <div className="brand__subtitle">
                Delete images from ChatGPT’s library
              </div>
            </div>
          </div>
          <button
            className="btn btn--sm"
            onClick={openOptionsPage}
            type="button"
          >
            Settings
          </button>
        </div>
        <p className="page-lead">
          Scan the ChatGPT image library, review exactly what matched, then type
          a confirmation to delete. Deletion is a soft delete in ChatGPT’s own
          library; it does not touch conversations or Notion pages.
        </p>
      </header>

      {!status?.auth.present && (
        <div className="banner banner--warn">
          No ChatGPT session captured. Open chatgpt.com, sign in, and reload the
          page before scanning.
        </div>
      )}

      {syncRunning && (
        <div className="banner banner--warn">
          A sync is running. Library cleanup is locked until it finishes.
        </div>
      )}

      {error && <div className="banner banner--danger">{error}</div>}
      {notice && <div className="banner banner--info">{notice}</div>}

      <section className="card stack stack--tight">
        <div className="warning-title">Destructive action</div>
        <p className="small">
          Images matching the query are removed from the ChatGPT library and may
          disappear from image pickers. Start with a narrow query, confirm the
          preview, and keep the extension open until the operation finishes.
        </p>
      </section>

      <section className="card stack">
        <div className="card__head">
          <span className="card__title">1. Scan</span>
          <span className="spacer" />
          {library?.phase === 'scanning' && (
            <span className="badge badge--ok">Scanning</span>
          )}
          {library?.phase === 'deleting' && (
            <span className="badge badge--warn">Deleting</span>
          )}
        </div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input
            className="input"
            placeholder="Filter by name or prompt (leave empty for the whole library)"
            value={query}
            disabled={scanning}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !scanning) {
                void scan();
              }
            }}
          />
          <button
            className="btn btn--primary"
            disabled={
              Boolean(busy) || scanning || syncRunning || !status?.auth.present
            }
            onClick={() => void scan()}
            type="button"
          >
            {busy === 'scan' ? 'Scanning…' : 'Scan library'}
          </button>
        </div>
        <span className="hint">
          Scanning only counts and lists items. Nothing is deleted until you
          confirm below.
        </span>
      </section>

      {library?.running && (
        <section className="card stack stack--tight">
          <div className="row row--between small">
            <span>{library.message}</span>
            <button
              className="btn btn--sm"
              disabled={busy === 'cancel'}
              onClick={() => void cancel()}
              type="button"
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
            </button>
          </div>
          <div className="progress">
            <div className="progress__bar" style={{ width: `${progress}%` }} />
          </div>
          <div className="stats">
            <div className="stat">
              <div className="stat__value">{library.total}</div>
              <div className="stat__label">Matched</div>
            </div>
            <div className="stat">
              <div className="stat__value">{library.deleted}</div>
              <div className="stat__label">Deleted</div>
            </div>
            <div className="stat">
              <div className="stat__value">{library.failed}</div>
              <div className="stat__label">Failed</div>
            </div>
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section className="card stack">
          <div className="card__head">
            <span className="card__title">2. Review preview</span>
            <span className="spacer" />
            <span className="badge badge--warn">
              {items.length} image{items.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="small muted">
            {scannedQuery.trim() ? (
              <>
                Matching <strong>“{scannedQuery.trim()}”</strong>
              </>
            ) : (
              <>
                The <strong>entire</strong> image library
              </>
            )}{' '}
            · scanned {new Date(scannedAt ?? Date.now()).toLocaleTimeString()}
          </div>
          <div className="scroll-box">
            {visibleItems.map((item, index) => (
              <div className="list-item" key={item.id}>
                <span className="list-item__index">{index + 1}</span>
                <span>{item.name}</span>
              </div>
            ))}
            {items.length > visibleItems.length && (
              <div className="list-item muted">
                +{items.length - visibleItems.length} more not shown
              </div>
            )}
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section className="card stack">
          <div className="card__head">
            <span className="card__title">3. Confirm deletion</span>
            <span className="spacer" />
            {library?.failed ? (
              <span className="badge badge--bad">{library.failed} failed</span>
            ) : null}
          </div>
          <div className="confirm-box stack stack--tight">
            <span className="small">
              Type <span className="mono">{expected}</span> to delete{' '}
              <strong>
                {items.length} image{items.length === 1 ? '' : 's'}
              </strong>{' '}
              {scannedQuery.trim() ? (
                <>
                  matching <strong>“{scannedQuery.trim()}”</strong>
                </>
              ) : (
                <>
                  from the <strong>entire</strong> library
                </>
              )}
              .
            </span>
            <input
              className="input mono"
              placeholder={expected}
              value={confirmation}
              disabled={scanning}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="row">
              <button
                className="btn btn--danger"
                disabled={
                  !confirmationMatches ||
                  Boolean(busy) ||
                  scanning ||
                  syncRunning
                }
                onClick={() => void remove()}
                type="button"
              >
                {busy === 'delete'
                  ? 'Deleting…'
                  : `Delete ${items.length} image${items.length === 1 ? '' : 's'}`}
              </button>
              <button
                className="btn btn--ghost"
                disabled={Boolean(busy) || scanning}
                onClick={() => {
                  setItems([]);
                  setConfirmation('');
                  void sendMessage({ type: 'CLEAR_LIBRARY_SCAN' });
                }}
                type="button"
              >
                Discard scan
              </button>
            </div>
          </div>
        </section>
      )}

      {library && library.errors.length > 0 && (
        <section className="card stack stack--tight">
          <span className="card__title">Errors</span>
          <ul className="error-list">
            {library.errors.map((entry, _index) => (
              <li key={entry.id}>
                {entry.fileName !== '—' ? `${entry.fileName}: ` : ''}
                {entry.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {library &&
        (library.phase === 'done' || library.phase === 'cancelled') && (
          <div className="banner banner--info">{library.message}</div>
        )}

      <div className="footer">
        <span>
          {status ? `${status.pending} generation(s) waiting to sync` : ''}
        </span>
        <span className="spacer" />
        <span>Deleting uses ChatGPT’s soft-delete endpoint.</span>
      </div>
    </div>
  );
}
