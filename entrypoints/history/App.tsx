import { useEffect, useState } from 'react';
import {
  openOptionsPage,
  type SyncedGenerationSummary,
  sendMessage,
} from '@/lib/messages';

function toDateMs(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  let ms: number;
  if (typeof value === 'number') {
    ms = value;
  } else {
    const num = Number(value);
    if (Number.isFinite(num) && value.trim() !== '') {
      ms = num;
    } else {
      const via = new Date(value);
      if (Number.isNaN(via.getTime())) {
        return undefined;
      }
      ms = via.getTime();
    }
  }
  return ms > 10_000_000_000 ? ms : ms * 1000;
}

function formatDateTime(value: string | number | undefined): string {
  const ms = toDateMs(value);
  if (ms === undefined) {
    return '—';
  }
  const date = new Date(ms);
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dayLabelFor(value: string | number | undefined): string {
  const ms = toDateMs(value);
  if (ms === undefined) {
    return 'Unknown date';
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(ms));
}

export default function App() {
  const [history, setHistory] = useState<SyncedGenerationSummary[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showUploaded, setShowUploaded] = useState(true);
  const [showLastSync, setShowLastSync] = useState(true);

  const groups = history
    ? history.reduce<{ label: string; items: SyncedGenerationSummary[] }[]>(
        (acc, item) => {
          const label = dayLabelFor(item.createdAt);
          const last = acc[acc.length - 1];
          if (last && last.label === label) {
            last.items.push(item);
          } else {
            acc.push({ label, items: [item] });
          }
          return acc;
        },
        [],
      )
    : null;
  const colSpan = 4 + (showUploaded ? 1 : 0) + (showLastSync ? 1 : 0);

  useEffect(() => {
    let cancelled = false;
    sendMessage({ type: 'GET_SYNCED_GENERATIONS', limit: 100 }).then(
      (result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error ?? 'Could not load synced history.');
          return;
        }
        setHistory(result.items);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

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
                Synced history
              </div>
              <div className="text-muted text-xs">
                Images uploaded to your Notion database via c2n
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
          Files listed here are ones already synced to Notion by this extension
          — independent of ChatGPT's own image library.
        </p>
      </header>

      {error && (
        <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-danger-soft text-ink border-[color-mix(in_srgb,var(--danger)_30%,transparent)]">
          {error}
        </div>
      )}

      <section className="bg-surface border border-edge rounded-xl p-3.5 shadow-[var(--shadow)] flex flex-col gap-2.5">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-[13px] font-semibold tracking-[0.01em]">
            Uploaded images
          </span>
          <span className="flex-1" />
          <button
            type="button"
            title={
              showUploaded ? 'Hide Uploaded column' : 'Show Uploaded column'
            }
            aria-pressed={showUploaded}
            onClick={() => setShowUploaded((v) => !v)}
            className="appearance-none inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border cursor-pointer transition-colors duration-150 disabled:opacity-50 text-muted border-edge bg-surface enabled:hover:bg-surface-muted"
          >
            Uploaded
          </button>
          <button
            type="button"
            title={
              showLastSync ? 'Hide Last sync column' : 'Show Last sync column'
            }
            aria-pressed={showLastSync}
            onClick={() => setShowLastSync((v) => !v)}
            className="appearance-none inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border cursor-pointer transition-colors duration-150 disabled:opacity-50 text-muted border-edge bg-surface enabled:hover:bg-surface-muted"
          >
            Last sync
          </button>
          {history && (
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-accent-soft text-success border-[color-mix(in_srgb,var(--success)_25%,transparent)]">
              {history.length} file{history.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {!history ? (
          <div className="text-xs text-muted">Loading…</div>
        ) : history.length === 0 ? (
          <div className="text-xs text-muted">No synced images yet.</div>
        ) : (
          <div className="max-h-[70vh] overflow-auto border border-edge rounded-lg bg-surface">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-surface-muted">
                <tr className="text-left text-muted uppercase tracking-[0.06em] text-[10.5px]">
                  <th className="px-2.5 py-2 font-semibold whitespace-nowrap">
                    Created
                  </th>
                  {showUploaded && (
                    <th className="px-2.5 py-2 font-semibold whitespace-nowrap">
                      Uploaded
                    </th>
                  )}
                  {showLastSync && (
                    <th className="px-2.5 py-2 font-semibold whitespace-nowrap">
                      Last sync
                    </th>
                  )}
                  <th className="px-2.5 py-2 font-semibold">Filename</th>
                  <th
                    className="px-2.5 py-2 font-semibold w-8"
                    aria-label="Copy prompt"
                  />
                  <th className="px-2.5 py-2 font-semibold text-right whitespace-nowrap">
                    URL
                  </th>
                </tr>
              </thead>
              {groups?.map((group) => (
                <tbody key={group.label}>
                  <tr className="bg-surface-muted">
                    <th
                      colSpan={colSpan}
                      className="px-2.5 py-1.5 text-left text-[10.5px] uppercase tracking-[0.08em] text-muted font-semibold border-t border-edge"
                    >
                      {group.label} · {group.items.length} image
                      {group.items.length === 1 ? '' : 's'}
                    </th>
                  </tr>
                  {group.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t border-edge align-middle"
                    >
                      <td className="px-2.5 py-1.5 text-muted tabular-nums whitespace-nowrap">
                        {formatDateTime(item.createdAt)}
                      </td>
                      {showUploaded && (
                        <td className="px-2.5 py-1.5 text-muted tabular-nums whitespace-nowrap">
                          {formatDateTime(item.uploadedAt)}
                        </td>
                      )}
                      {showLastSync && (
                        <td className="px-2.5 py-1.5 text-muted tabular-nums whitespace-nowrap">
                          {formatDateTime(item.lastSyncedAt ?? item.uploadedAt)}
                        </td>
                      )}
                      <td className="px-2.5 py-1.5 max-w-[280px] [overflow-wrap:anywhere]">
                        <a
                          className="font-medium text-accent hover:underline"
                          href={item.url}
                          rel="noreferrer"
                          target="_blank"
                          title={item.url}
                        >
                          {item.fileName}
                        </a>
                      </td>
                      <td className="px-2.5 py-1.5 text-center">
                        <button
                          type="button"
                          className="appearance-none inline-flex items-center gap-1 text-muted hover:text-ink cursor-pointer transition-colors duration-150"
                          title="copy prompt"
                          onClick={() => {
                            void navigator.clipboard.writeText(item.prompt);
                            setCopiedId(item.id);
                            window.setTimeout(
                              () =>
                                setCopiedId((current) =>
                                  current === item.id ? null : current,
                                ),
                              1500,
                            );
                          }}
                        >
                          {copiedId === item.id ? (
                            <svg
                              aria-hidden="true"
                              className="size-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                            >
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          ) : (
                            <svg
                              aria-hidden="true"
                              className="size-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                            >
                              <rect
                                width="14"
                                height="14"
                                x="8"
                                y="8"
                                rx="2"
                                ry="2"
                              />
                              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                            </svg>
                          )}
                        </button>
                      </td>
                      <td className="px-2.5 py-1.5 text-right">
                        <a
                          className="inline-flex items-center gap-1 text-muted hover:text-ink"
                          href={item.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          ChatGPT ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
