import { describe, expect, it } from 'vitest';
import {
  HttpError,
  isRetryable,
  parseRetryAfter,
  retry,
  sleep,
} from '@/lib/retry';

describe('HttpError', () => {
  it('carries status, url, body, and truncates the message', () => {
    const err = new HttpError(
      429,
      'https://api.example.com/x',
      'a'.repeat(500),
    );
    expect(err.status).toBe(429);
    expect(err.url).toBe('https://api.example.com/x');
    expect(err.body).toHaveLength(500);
    expect(err.message).toContain('HTTP 429');
    expect(err.message.length).toBeLessThan(500);
  });
});

describe('isRetryable', () => {
  it('retries only 429/5xx and network TypeErrors', () => {
    expect(isRetryable(new HttpError(429, 'u', ''))).toBe(true);
    expect(isRetryable(new HttpError(500, 'u', ''))).toBe(true);
    expect(isRetryable(new HttpError(503, 'u', ''))).toBe(true);
    expect(isRetryable(new HttpError(400, 'u', ''))).toBe(false);
    expect(isRetryable(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryable(new Error('boom'))).toBe(false);
    expect(isRetryable(new DOMException('Aborted', 'AbortError'))).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds, caps at 60, and ignores garbage', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('120')).toBe(60_000);
    expect(parseRetryAfter('abc')).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
  });
});

describe('retry', () => {
  it('returns the first success without extra attempts', async () => {
    let calls = 0;
    const result = await retry(async () => {
      calls += 1;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries retryable failures then succeeds', async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new HttpError(503, 'u', 'busy');
        }
        return 'done';
      },
      { minDelayMs: 1, maxDelayMs: 5 },
    );
    expect(result).toBe('done');
    expect(calls).toBe(3);
  });

  it('gives up after attempts and surfaces the last error', async () => {
    const error = new HttpError(500, 'u', 'x');
    await expect(
      retry(
        async () => {
          throw error;
        },
        { attempts: 3, minDelayMs: 1, maxDelayMs: 2 },
      ),
    ).rejects.toBe(error);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls += 1;
          throw new HttpError(404, 'u', 'nf');
        },
        { attempts: 5 },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(1);
  });

  it('aborts immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      retry(async () => 'never', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('sleep', () => {
  it('resolves after the delay', async () => {
    await sleep(1);
  });

  it('rejects when aborted', async () => {
    const controller = new AbortController();
    const pending = sleep(100, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
