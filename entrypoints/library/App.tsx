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
    <div className="flex flex-col gap-4 max-w-[760px] mx-auto px-5 pt-7 pb-12">
      <header className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 flex-wrap justify-between">
          <div className="flex items-center gap-2.5">
            <div className="grid place-items-center size-[34px] rounded-[10px] bg-accent text-bg font-bold text-[13px] tracking-[0.02em]">
              c2n
            </div>
            <div>
              <div className="text-base font-semibold leading-tight">
                Library cleanup
              </div>
              <div className="text-muted text-xs">
                Delete images from ChatGPT’s library
              </div>
            </div>
          </div>
          <button
            className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-2 py-1 text-[11.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-surface text-ink border-edge enabled:hover:bg-surface-muted"
            onClick={openOptionsPage}
            type="button"
          >
            Settings
          </button>
        </div>
        <p className="text-muted text-[13px] max-w-[62ch]">
          Scan the ChatGPT image library, review exactly what matched, then type
          a confirmation to delete. Deletion is a soft delete in ChatGPT’s own
          library; it does not touch conversations or Notion pages.
        </p>
      </header>

      {!status?.auth.present && (
        <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-warning-soft text-ink border-[color-mix(in_srgb,var(--warning)_30%,transparent)]">
          No ChatGPT session captured. Open chatgpt.com, sign in, and reload the
          page before scanning.
        </div>
      )}

      {syncRunning && (
        <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-warning-soft text-ink border-[color-mix(in_srgb,var(--warning)_30%,transparent)]">
          A sync is running. Library cleanup is locked until it finishes.
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

      <section className="bg-surface border border-edge rounded-xl p-3.5 shadow-[var(--shadow)] flex flex-col gap-1.5">
        <div className="text-danger font-bold">Destructive action</div>
        <p className="text-xs">
          Images matching the query are removed from the ChatGPT library and may
          disappear from image pickers. Start with a narrow query, confirm the
          preview, and keep the extension open until the operation finishes.
        </p>
      </section>

      <section className="bg-surface border border-edge rounded-xl p-3.5 shadow-[var(--shadow)] flex flex-col gap-2.5">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-[13px] font-semibold tracking-[0.01em]">
            Scan Library
          </span>
          <span className="flex-1" />
          {library?.phase === 'scanning' && (
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-accent-soft text-success border-[color-mix(in_srgb,var(--success)_25%,transparent)]">
              Scanning
            </span>
          )}
          {library?.phase === 'deleting' && (
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-warning-soft text-warning border-[color-mix(in_srgb,var(--warning)_25%,transparent)]">
              Deleting
            </span>
          )}
        </div>
        <div className="flex items-center gap-2" style={{ flexWrap: 'nowrap' }}>
          <input
            className="w-full font-[inherit] text-[13px] text-ink bg-surface border border-edge rounded-lg px-2.5 py-2 outline-none focus:border-accent focus:ring-3 focus:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)]"
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
            className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-3 py-1.75 text-[12.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-accent text-white dark:text-[#10201c] border-accent enabled:hover:bg-accent-strong enabled:hover:border-accent-strong"
            disabled={
              Boolean(busy) || scanning || syncRunning || !status?.auth.present
            }
            onClick={() => void scan()}
            type="button"
          >
            {busy === 'scan' ? 'Scanning…' : 'Scan'}
          </button>
        </div>
        <span className="text-muted text-[11.5px]">
          Scanning only counts and lists items. Nothing is deleted until you
          confirm below.
        </span>
      </section>

      {library?.running && (
        <section className="bg-surface border border-edge rounded-xl p-3.5 shadow-[var(--shadow)] flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap justify-between text-xs">
            <span>{library.message}</span>
            <button
              className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-2 py-1 text-[11.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-surface text-ink border-edge enabled:hover:bg-surface-muted"
              disabled={busy === 'cancel'}
              onClick={() => void cancel()}
              type="button"
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
            </button>
          </div>
          <div
            className="h-[7px] rounded-full bg-surface-muted overflow-hidden border border-edge"
            aria-hidden="true"
          >
            <div
              className="h-full bg-accent rounded-full transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-surface-muted border border-edge rounded-lg px-2.25 py-1.75">
              <div className="text-base font-semibold leading-[1.1] tabular-nums">
                {library.total}
              </div>
              <div className="text-[10.5px] text-muted uppercase tracking-[0.06em] mt-0.5">
                Matched
              </div>
            </div>
            <div className="bg-surface-muted border border-edge rounded-lg px-2.25 py-1.75">
              <div className="text-base font-semibold leading-[1.1] tabular-nums">
                {library.deleted}
              </div>
              <div className="text-[10.5px] text-muted uppercase tracking-[0.06em] mt-0.5">
                Deleted
              </div>
            </div>
            <div className="bg-surface-muted border border-edge rounded-lg px-2.25 py-1.75">
              <div className="text-base font-semibold leading-[1.1] tabular-nums">
                {library.failed}
              </div>
              <div className="text-[10.5px] text-muted uppercase tracking-[0.06em] mt-0.5">
                Failed
              </div>
            </div>
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section className="bg-surface border border-edge rounded-xl p-3.5 shadow-[var(--shadow)] flex flex-col gap-2.5">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[13px] font-semibold tracking-[0.01em]">
              2. Review preview
            </span>
            <span className="flex-1" />
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-warning-soft text-warning border-[color-mix(in_srgb,var(--warning)_25%,transparent)]">
              {items.length} image{items.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="text-xs text-muted">
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
          <div className="max-h-70 overflow-auto border border-edge rounded-lg bg-surface">
            {visibleItems.map((item, index) => (
              <div
                className="flex gap-2 items-center px-2.5 py-1.5 text-xs border-t border-edge first:border-t-0 [overflow-wrap:anywhere]"
                key={item.id}
              >
                <span className="text-muted tabular-nums min-w-[2.2em] text-right text-[11px]">
                  {index + 1}
                </span>
                <span>{item.name}</span>
              </div>
            ))}
            {items.length > visibleItems.length && (
              <div className="flex gap-2 items-center px-2.5 py-1.5 text-xs border-t border-edge first:border-t-0 [overflow-wrap:anywhere] text-muted">
                +{items.length - visibleItems.length} more not shown
              </div>
            )}
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section className="bg-surface border border-edge rounded-xl p-3.5 shadow-[var(--shadow)] flex flex-col gap-2.5">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[13px] font-semibold tracking-[0.01em]">
              3. Confirm deletion
            </span>
            <span className="flex-1" />
            {library?.failed ? (
              <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-danger-soft text-danger border-[color-mix(in_srgb,var(--danger)_25%,transparent)]">
                {library.failed} failed
              </span>
            ) : null}
          </div>
          <div className="border border-[color-mix(in_srgb,var(--danger)_40%,var(--border))] bg-[color-mix(in_srgb,var(--danger-soft)_55%,var(--surface))] rounded-[10px] p-3 flex flex-col gap-1.5">
            <span className="text-xs">
              Type <span className="font-mono text-xs">{expected}</span> to
              delete{' '}
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
              className="w-full font-[inherit] text-[13px] text-ink bg-surface border border-edge rounded-lg px-2.5 py-2 outline-none focus:border-accent focus:ring-3 focus:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)] font-mono text-xs"
              placeholder={expected}
              value={confirmation}
              disabled={scanning}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-3 py-1.75 text-[12.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-danger text-white border-danger enabled:hover:brightness-110"
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
                className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-3 py-1.75 text-[12.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-transparent text-muted border-transparent enabled:hover:bg-surface-muted enabled:hover:text-ink"
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
        <section className="bg-surface border border-edge rounded-xl p-3.5 shadow-[var(--shadow)] flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold tracking-[0.01em]">
            Errors
          </span>
          <ul className="flex flex-col gap-1.5 max-h-40 overflow-auto list-none m-0 p-0">
            {library.errors.map((entry, _index) => (
              <li
                key={entry.id}
                className="text-[11.5px] p-1.5 rounded-[7px] bg-danger-soft text-danger [overflow-wrap:anywhere]"
              >
                {entry.fileName !== '—' ? `${entry.fileName}: ` : ''}
                {entry.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {library &&
        (library.phase === 'done' || library.phase === 'cancelled') && (
          <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-accent-soft text-ink border-[color-mix(in_srgb,var(--accent)_25%,transparent)]">
            {library.message}
          </div>
        )}

      <div className="flex items-center gap-2.5 pt-0.5 text-muted text-[11.5px]">
        <span>
          {status ? `${status.pending} generation(s) waiting to sync` : ''}
        </span>
        <span className="flex-1" />
        <span>Deleting uses ChatGPT’s soft-delete endpoint.</span>
      </div>
    </div>
  );
}
