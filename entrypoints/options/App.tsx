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
    <div className="app app--page">
      <header className="stack">
        <div className="row row--between">
          <div className="brand">
            <div className="brand__mark">c2n</div>
            <div>
              <div className="brand__title">ChatGPT → Notion</div>
              <div className="brand__subtitle">Browser extension settings</div>
            </div>
          </div>
          <span className="badge badge--neutral">
            v{status?.version ?? '…'}
          </span>
        </div>
        <p className="page-lead">
          c2n syncs ChatGPT image generations to a Notion database only when you
          press <strong>Sync now</strong>. Your ChatGPT session token is
          observed from chatgpt.com traffic and kept in this browser session;
          nothing is sent anywhere except Notion.
        </p>
      </header>

      {errors.length > 0 && (
        <div className="banner banner--danger">
          <ul className="plain-list stack stack--tight">
            {errors.map((entry, _index) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      )}
      {notice && <div className="banner banner--info">{notice}</div>}

      <section className="card stack">
        <div className="card__head">
          <span className="card__title">Notion database</span>
          <span className="spacer" />
          {status?.notionConfigured ? (
            <span className="badge badge--ok">Configured</span>
          ) : (
            <span className="badge badge--warn">Incomplete</span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="notion-token">
            Integration token
          </label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input
              id="notion-token"
              className="input mono"
              type={showToken ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="ntn_…"
              value={form.notion.apiKey}
              onChange={(event) => updateNotion('apiKey', event.target.value)}
            />
            <button
              className="btn btn--sm"
              onClick={() => setShowToken((current) => !current)}
              type="button"
            >
              {showToken ? 'Hide' : 'Show'}
            </button>
          </div>
          <span className="hint">
            Create an internal integration at notion.so/my-integrations, then
            share your database with it.
          </span>
        </div>

        <div className="grid-2">
          <div className="field">
            <label className="field__label" htmlFor="notion-database">
              Database ID or URL
            </label>
            <input
              id="notion-database"
              className="input mono"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://www.notion.so/…"
              value={form.notion.databaseId}
              onChange={(event) =>
                updateNotion('databaseId', event.target.value)
              }
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="notion-version">
              Notion API version
            </label>
            <input
              id="notion-version"
              className="input mono"
              autoComplete="off"
              spellCheck={false}
              value={form.notion.version}
              onChange={(event) => updateNotion('version', event.target.value)}
            />
          </div>
        </div>

        <div className="banner">
          The database must have a <strong>Name</strong> property of type{' '}
          <strong>Title</strong> and an <strong>Image</strong> property of type{' '}
          <strong>Files</strong>. Use <strong>Test connection</strong> to verify
          both before syncing.
        </div>

        <div className="row">
          <button
            className="btn"
            disabled={Boolean(busy)}
            onClick={() => void onTest()}
            type="button"
          >
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          <button
            className="btn btn--primary"
            disabled={Boolean(busy)}
            onClick={() => void onSave()}
            type="button"
          >
            {busy === 'save' ? 'Saving…' : 'Save settings'}
          </button>
        </div>

        {tests && (
          <div className="checks">
            {tests.checks.map((check, _index) => (
              <div
                className={`check-row ${check.ok ? 'check-row--ok' : 'check-row--bad'}`}
                key={check.label}
              >
                <span className="check-row__icon">{check.ok ? '✓' : '✕'}</span>
                <span>
                  <strong>{check.label}</strong>
                  {check.detail ? (
                    <span className="muted"> — {check.detail}</span>
                  ) : null}
                </span>
              </div>
            ))}
            <div
              className={
                tests.ok ? 'banner banner--info' : 'banner banner--danger'
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

      <section className="card stack">
        <div className="card__head">
          <span className="card__title">Sync behavior</span>
        </div>

        <div className="grid-2">
          <div className="field">
            <label className="field__label" htmlFor="sync-limit">
              Recent generations to inspect
            </label>
            <input
              id="sync-limit"
              className="input"
              type="number"
              min={1}
              max={500}
              value={form.sync.limit}
              onChange={(event) =>
                updateSync('limit', Number(event.target.value))
              }
            />
            <span className="hint">
              Between 1 and 500. Applies to each manual sync or resume.
            </span>
          </div>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={form.sync.checkNotionDuplicates}
            onChange={(event) =>
              updateSync('checkNotionDuplicates', event.target.checked)
            }
          />
          <span>
            <span className="check__title">Check Notion for duplicates</span>
            <span className="check__desc">
              Query the database for the generated filename before downloading,
              and mark matches as already uploaded.
            </span>
          </span>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={form.sync.embedPromptMetadata}
            onChange={(event) =>
              updateSync('embedPromptMetadata', event.target.checked)
            }
          />
          <span>
            <span className="check__title">Embed prompt in PNG metadata</span>
            <span className="check__desc">
              Writes a <span className="mono">Prompt</span> text chunk into PNG
              files before uploading. Non-PNG images are uploaded unchanged.
            </span>
          </span>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={form.notifyOnFinish}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                notifyOnFinish: event.target.checked,
              }))
            }
          />
          <span>
            <span className="check__title">Notify when a sync finishes</span>
            <span className="check__desc">
              Shows a browser notification on finish or failure.
            </span>
          </span>
        </label>

        <div className="row">
          <button
            className="btn btn--primary"
            disabled={Boolean(busy)}
            onClick={() => void onSave()}
            type="button"
          >
            {busy === 'save' ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </section>

      <section className="card stack">
        <div className="card__head">
          <span className="card__title">ChatGPT session</span>
          <span className="spacer" />
          {status?.auth.present ? (
            <span className="badge badge--ok">
              {status.auth.email ?? 'Captured'}
            </span>
          ) : status?.auth.capturedAt ? (
            <span className="badge badge--warn">Expired</span>
          ) : (
            <span className="badge badge--bad">Not captured</span>
          )}
        </div>
        {status?.auth.present ? (
          <div className="stack stack--tight small">
            <span>
              Captured {formatDateTime(status.auth.capturedAt)} · last observed{' '}
              {formatDateTime(status.auth.lastSeenAt)}
              {status.auth.expiresAt
                ? ` · expires ${formatDateTime(status.auth.expiresAt)}`
                : ''}
            </span>
            <span className="muted">
              No account login is stored here. Reload chatgpt.com whenever the
              token expires.
            </span>
          </div>
        ) : (
          <div className="banner banner--warn">
            {status?.auth.capturedAt
              ? 'The captured token has expired. Reload chatgpt.com so c2n can observe a fresh one.'
              : 'Open chatgpt.com, sign in, and reload the page. The extension observes the Authorization header ChatGPT sends and keeps the token for this browser session only.'}
          </div>
        )}
        <div className="row">
          <button className="btn" onClick={onOpenChatGpt} type="button">
            Open ChatGPT
          </button>
          <button
            className="btn btn--ghost"
            disabled={Boolean(busy) || !status?.auth.capturedAt}
            onClick={() => void onForgetToken()}
            type="button"
          >
            {busy === 'forget' ? 'Forgetting…' : 'Forget captured token'}
          </button>
        </div>
      </section>

      <section className="card stack stack--tight">
        <div className="card__head">
          <span className="card__title">Local state</span>
        </div>
        <div className="row row--between small">
          <span className="muted">Generations waiting to upload</span>
          <span>{status?.pending ?? 0}</span>
        </div>
        <div className="row row--between small">
          <span className="muted">Last sync</span>
          <span>
            {status?.lastRun
              ? `${formatDateTime(status.lastRun.finishedAt)} · ${status.lastRun.uploaded} uploaded, ${status.lastRun.skipped} skipped, ${status.lastRun.failed} failed`
              : 'Never'}
          </span>
        </div>
        <div className="divider" />
        <div className="link-row">
          <a
            href={browser.runtime.getURL('/library.html')}
            target="_blank"
            rel="noreferrer"
          >
            ChatGPT library cleanup
          </a>
          <a
            href="https://github.com/labasubagia/c2n"
            target="_blank"
            rel="noreferrer"
          >
            c2n on GitHub
          </a>
        </div>
      </section>
    </div>
  );
}
