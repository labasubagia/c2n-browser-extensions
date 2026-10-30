import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { isStateUpdate, type RuntimeStatus, sendMessage } from '@/lib/messages';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  validateSettings,
} from '@/lib/settings';
import type { NotionTestResult, Settings } from '@/lib/types';
import { errorMessage } from '@/lib/util';

function formatDateTime(value: number | undefined): string {
  if (!value) {
    return 'unknown';
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function App() {
  const [form, setForm] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [tests, setTests] = useState<NotionTestResult | null>(null);
  const [showToken, setShowToken] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await sendMessage({ type: 'GET_STATUS' });
      setStatus(next);
    } catch (error) {
      setErrors([errorMessage(error)]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const [loaded] = await Promise.all([loadSettings(), refresh()]);
      setForm(loaded);
    })();
    const listener = (message: unknown) => {
      if (isStateUpdate(message)) {
        setStatus((current) =>
          current
            ? { ...current, sync: message.sync, library: message.library }
            : current,
        );
        if (!message.sync.running) {
          void refresh();
        }
      }
      return false;
    };
    browser.runtime.onMessage.addListener(listener);
    const timer = window.setInterval(() => {
      void refresh();
    }, 5_000);
    return () => {
      window.clearInterval(timer);
      browser.runtime.onMessage.removeListener(listener);
    };
  }, [refresh]);

  const updateNotion = <K extends keyof Settings['notion']>(
    key: K,
    value: Settings['notion'][K],
  ) => {
    setForm((current) => ({
      ...current,
      notion: { ...current.notion, [key]: value },
    }));
  };

  const updateSync = <K extends keyof Settings['sync']>(
    key: K,
    value: Settings['sync'][K],
  ) => {
    setForm((current) => ({
      ...current,
      sync: { ...current.sync, [key]: value },
    }));
  };

  const save = async (): Promise<boolean> => {
    const validation = validateSettings(form);
    if (validation.length) {
      setErrors(validation);
      setNotice(null);
      return false;
    }
    setErrors([]);
    setNotice(null);
    const saved = await saveSettings(form);
    setForm(saved);
    setNotice('Settings saved.');
    await refresh();
    return true;
  };

  const onSave = async () => {
    setBusy('save');
    try {
      await save();
    } catch (error) {
      setErrors([errorMessage(error)]);
    } finally {
      setBusy(null);
    }
  };

  const onTest = async () => {
    setBusy('test');
    setTests(null);
    setErrors([]);
    setNotice(null);
    try {
      if (!(await save())) {
        return;
      }
      const result = await sendMessage({ type: 'TEST_NOTION' });
      setTests(result);
    } catch (error) {
      setErrors([errorMessage(error)]);
    } finally {
      setBusy(null);
    }
  };

  const onForgetToken = async () => {
    setBusy('forget');
    setNotice(null);
    try {
      await sendMessage({ type: 'FORGET_AUTH' });
      await refresh();
      setNotice(
        'Captured ChatGPT token removed. Reload chatgpt.com to capture a new one.',
      );
    } catch (error) {
      setErrors([errorMessage(error)]);
    } finally {
      setBusy(null);
    }
  };

  const onOpenChatGpt = () => {
    void browser.tabs.create({ url: 'https://chatgpt.com/' });
  };

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
                ChatGPT → Notion
              </div>
              <div className="text-muted text-xs">
                Browser extension settings
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-surface-muted text-muted border-edge">
            v{status?.version ?? '…'}
          </span>
        </div>
        <p className="text-muted text-[13px] max-w-[62ch]">
          c2n syncs ChatGPT image generations to a Notion database only when you
          press <strong>Sync now</strong>. Your ChatGPT session token is
          observed from chatgpt.com traffic and kept in this browser session;
          nothing is sent anywhere except Notion.
        </p>
      </header>

      {errors.length > 0 && (
        <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-danger-soft text-ink border-[color-mix(in_srgb,var(--danger)_30%,transparent)]">
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {errors.map((entry, _index) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
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
            Notion database
          </span>
          <span className="flex-1" />
          {status?.notionConfigured ? (
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-accent-soft text-success border-[color-mix(in_srgb,var(--success)_25%,transparent)]">
              Configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-warning-soft text-warning border-[color-mix(in_srgb,var(--warning)_25%,transparent)]">
              Incomplete
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.25">
          <label className="text-xs font-semibold" htmlFor="notion-token">
            Integration token
          </label>
          <div
            className="flex items-center gap-2"
            style={{ flexWrap: 'nowrap' }}
          >
            <input
              id="notion-token"
              className="w-full font-[inherit] text-[13px] text-ink bg-surface border border-edge rounded-lg px-2.5 py-2 outline-none focus:border-accent focus:ring-3 focus:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)] font-mono text-xs"
              type={showToken ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="ntn_…"
              value={form.notion.apiKey}
              onChange={(event) => updateNotion('apiKey', event.target.value)}
            />
            <button
              className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-2 py-1 text-[11.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-surface text-ink border-edge enabled:hover:bg-surface-muted"
              onClick={() => setShowToken((current) => !current)}
              type="button"
            >
              {showToken ? 'Hide' : 'Show'}
            </button>
          </div>
          <span className="text-muted text-[11.5px]">
            Create an internal integration at notion.so/my-integrations, then
            share your database with it.
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <div className="flex flex-col gap-1.25">
            <label className="text-xs font-semibold" htmlFor="notion-database">
              Database ID or URL
            </label>
            <input
              id="notion-database"
              className="w-full font-[inherit] text-[13px] text-ink bg-surface border border-edge rounded-lg px-2.5 py-2 outline-none focus:border-accent focus:ring-3 focus:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)] font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://www.notion.so/…"
              value={form.notion.databaseId}
              onChange={(event) =>
                updateNotion('databaseId', event.target.value)
              }
            />
          </div>
          <div className="flex flex-col gap-1.25">
            <label className="text-xs font-semibold" htmlFor="notion-version">
              Notion API version
            </label>
            <input
              id="notion-version"
              className="w-full font-[inherit] text-[13px] text-ink bg-surface border border-edge rounded-lg px-2.5 py-2 outline-none focus:border-accent focus:ring-3 focus:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)] font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
              value={form.notion.version}
              onChange={(event) => updateNotion('version', event.target.value)}
            />
          </div>
        </div>

        <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border border-edge bg-surface-muted text-ink">
          The database must have a <strong>Name</strong> property of type{' '}
          <strong>Title</strong> and an <strong>Image</strong> property of type{' '}
          <strong>Files</strong>. Use <strong>Test connection</strong> to verify
          both before syncing.
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-3 py-1.75 text-[12.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-surface text-ink border-edge enabled:hover:bg-surface-muted"
            disabled={Boolean(busy)}
            onClick={() => void onTest()}
            type="button"
          >
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
        </div>

        {tests && (
          <div className="flex flex-col gap-1">
            {tests.checks.map((check, _index) => (
              <div
                className={`flex items-start gap-1.75 text-xs`}
                key={check.label}
              >
                <span
                  className={`shrink-0 w-4 text-center font-bold ${check.ok ? 'text-success' : 'text-danger'}`}
                >
                  {check.ok ? '✓' : '✕'}
                </span>
                <span>
                  <strong>{check.label}</strong>
                  {check.detail ? (
                    <span className="text-muted"> — {check.detail}</span>
                  ) : null}
                </span>
              </div>
            ))}
            <div
              className={
                tests.ok
                  ? 'p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-accent-soft text-ink border-[color-mix(in_srgb,var(--accent)_25%,transparent)]'
                  : 'p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-danger-soft text-ink border-[color-mix(in_srgb,var(--danger)_30%,transparent)]'
              }
              style={{ marginTop: 6 }}
            >
              {tests.ok
                ? 'Database looks good. c2n is ready to sync.'
                : (tests.error ?? 'The database did not pass validation.')}
            </div>
          </div>
        )}
      </section>

      <section className="bg-surface border border-edge rounded-xl p-3.5 shadow-[var(--shadow)] flex flex-col gap-2.5">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-[13px] font-semibold tracking-[0.01em]">
            Sync behavior
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <div className="flex flex-col gap-1.25">
            <label className="text-xs font-semibold" htmlFor="sync-limit">
              Recent generations to inspect
            </label>
            <input
              id="sync-limit"
              className="w-full font-[inherit] text-[13px] text-ink bg-surface border border-edge rounded-lg px-2.5 py-2 outline-none focus:border-accent focus:ring-3 focus:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)]"
              type="number"
              min={1}
              max={500}
              value={form.sync.limit}
              onChange={(event) =>
                updateSync('limit', Number(event.target.value))
              }
            />
            <span className="text-muted text-[11.5px]">
              Between 1 and 500. Applies to each manual sync or resume.
            </span>
          </div>
        </div>

        <label className="flex items-start gap-2.25 py-2 border-t border-edge [&:first-of-type]:border-t-0 [&:first-of-type]:pt-0">
          <input
            className="mt-0.5 accent-accent"
            type="checkbox"
            checked={form.sync.checkNotionDuplicates}
            onChange={(event) =>
              updateSync('checkNotionDuplicates', event.target.checked)
            }
          />
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[12.5px] font-semibold">
              Check Notion for duplicates
            </span>
            <span className="text-[11.5px] text-muted">
              Query the database for the generated filename before downloading,
              and mark matches as already uploaded.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.25 py-2 border-t border-edge [&:first-of-type]:border-t-0 [&:first-of-type]:pt-0">
          <input
            className="mt-0.5 accent-accent"
            type="checkbox"
            checked={form.sync.embedPromptMetadata}
            onChange={(event) =>
              updateSync('embedPromptMetadata', event.target.checked)
            }
          />
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[12.5px] font-semibold">
              Embed prompt in PNG metadata
            </span>
            <span className="text-[11.5px] text-muted">
              Writes a <span className="font-mono text-xs">Prompt</span> text
              chunk into PNG files before uploading. Non-PNG images are uploaded
              unchanged.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.25 py-2 border-t border-edge [&:first-of-type]:border-t-0 [&:first-of-type]:pt-0">
          <input
            className="mt-0.5 accent-accent"
            type="checkbox"
            checked={form.notifyOnFinish}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                notifyOnFinish: event.target.checked,
              }))
            }
          />
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[12.5px] font-semibold">
              Notify when a sync finishes
            </span>
            <span className="text-[11.5px] text-muted">
              Shows a browser notification on finish or failure.
            </span>
          </span>
        </label>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-3 py-1.75 text-[12.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-accent text-white dark:text-[#10201c] border-accent enabled:hover:bg-accent-strong enabled:hover:border-accent-strong"
            disabled={Boolean(busy)}
            onClick={() => void onSave()}
            type="button"
          >
            {busy === 'save' ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </section>

      <section className="bg-surface border border-edge rounded-xl p-3.5 shadow-[var(--shadow)] flex flex-col gap-2.5">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-[13px] font-semibold tracking-[0.01em]">
            ChatGPT session
          </span>
          <span className="flex-1" />
          {status?.auth.present ? (
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-accent-soft text-success border-[color-mix(in_srgb,var(--success)_25%,transparent)]">
              {status.auth.email ?? 'Captured'}
            </span>
          ) : status?.auth.capturedAt ? (
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-warning-soft text-warning border-[color-mix(in_srgb,var(--warning)_25%,transparent)]">
              Expired
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.25 rounded-full px-2 py-0.5 text-[11px] font-semibold border whitespace-nowrap max-w-[220px] truncate bg-danger-soft text-danger border-[color-mix(in_srgb,var(--danger)_25%,transparent)]">
              Not captured
            </span>
          )}
        </div>
        {status?.auth.present ? (
          <div className="flex flex-col gap-1.5 text-xs">
            <span>
              Captured {formatDateTime(status.auth.capturedAt)} · last observed{' '}
              {formatDateTime(status.auth.lastSeenAt)}
              {status.auth.expiresAt
                ? ` · expires ${formatDateTime(status.auth.expiresAt)}`
                : ''}
            </span>
            <span className="text-muted">
              No account login is stored here. Reload chatgpt.com whenever the
              token expires.
            </span>
          </div>
        ) : (
          <div className="p-2.5 px-3 rounded-[10px] text-[12.5px] border bg-warning-soft text-ink border-[color-mix(in_srgb,var(--warning)_30%,transparent)]">
            {status?.auth.capturedAt
              ? 'The captured token has expired. Reload chatgpt.com so c2n can observe a fresh one.'
              : 'Open chatgpt.com, sign in, and reload the page. The extension observes the Authorization header ChatGPT sends and keeps the token for this browser session only.'}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-3 py-1.75 text-[12.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-surface text-ink border-edge enabled:hover:bg-surface-muted"
            onClick={onOpenChatGpt}
            type="button"
          >
            Open ChatGPT
          </button>
          <button
            className="appearance-none inline-flex items-center justify-center gap-1.5 border rounded-lg px-3 py-1.75 text-[12.5px] font-semibold cursor-pointer font-[inherit] transition-colors duration-150 enabled:active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed bg-transparent text-muted border-transparent enabled:hover:bg-surface-muted enabled:hover:text-ink"
            disabled={Boolean(busy) || !status?.auth.capturedAt}
            onClick={() => void onForgetToken()}
            type="button"
          >
            {busy === 'forget' ? 'Forgetting…' : 'Forget captured token'}
          </button>
        </div>
      </section>

      <section className="bg-surface border border-edge rounded-xl p-3.5 shadow-[var(--shadow)] flex flex-col gap-1.5">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-[13px] font-semibold tracking-[0.01em]">
            Local state
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-between text-xs">
          <span className="text-muted">Generations waiting to upload</span>
          <span>{status?.pending ?? 0}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-between text-xs">
          <span className="text-muted">Last sync</span>
          <span>
            {status?.lastRun
              ? `${formatDateTime(status.lastRun.finishedAt)} · ${status.lastRun.uploaded} uploaded, ${status.lastRun.skipped} skipped, ${status.lastRun.failed} failed`
              : 'Never'}
          </span>
        </div>
        <div className="h-px bg-edge my-0.5" />
        <div className="flex gap-3 flex-wrap text-xs">
          <a
            href={browser.runtime.getURL('/library.html')}
            target="_blank"
            rel="noreferrer"
          >
            ChatGPT library cleanup
          </a>
          <a
            href="https://github.com/labasubagia/c2n-browser-extensions"
            target="_blank"
            rel="noreferrer"
          >
            Github
          </a>
        </div>
      </section>
    </div>
  );
}
