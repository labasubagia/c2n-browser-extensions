import { isAbortError, safeUrl, truncate } from './util';

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  readonly retryAfterMs?: number;

  constructor(
    status: number,
    url: string,
    body: string,
    retryAfterMs?: number,
  ) {
    super(`HTTP ${status} for ${url}${body ? `: ${truncate(body, 300)}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface RetryOptions {
  attempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  retryOn?: (error: unknown) => boolean;
  onRetry?: (error: unknown, delayMs: number, attempt: number) => void;
}

const DEFAULT_ATTEMPTS = 10;
const DEFAULT_MIN_DELAY_MS = 2_000;
const DEFAULT_MAX_DELAY_MS = 60_000;

export function isRetryable(error: unknown): boolean {
  if (isAbortError(error)) {
    return false;
  }
  if (error instanceof HttpError) {
    return error.status === 429 || error.status >= 500;
  }
  // fetch() rejects with a TypeError for network failures.
  return error instanceof TypeError;
}

export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds, 60) * 1000;
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(0, date - now), 60_000);
  }
  return undefined;
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const minDelay = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const shouldRetry = options.retryOn ?? isRetryable;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (isAbortError(error) || !shouldRetry(error) || attempt === attempts) {
        throw error;
      }
      const retryAfter =
        error instanceof HttpError ? error.retryAfterMs : undefined;
      const delay = Math.min(
        maxDelay,
        retryAfter ?? minDelay * 2 ** (attempt - 1),
      );
      options.onRetry?.(error, delay, attempt);
      await sleep(delay, options.signal);
    }
  }
  throw lastError;
}

export async function fetchChecked(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(url, { ...init, signal });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new HttpError(
      response.status,
      safeUrl(url),
      body,
      parseRetryAfter(response.headers.get('Retry-After')),
    );
  }
  return response;
}

export interface RequestOptions extends RetryOptions {
  retryOn?: (error: unknown) => boolean;
}

export async function requestWithRetry(
  url: string,
  init: RequestInit,
  options: RequestOptions = {},
): Promise<Response> {
  return retry(() => fetchChecked(url, init, options.signal), options);
}

export async function requestBlobWithRetry(
  url: string,
  init: RequestInit,
  options: RequestOptions = {},
): Promise<Blob> {
  return retry(async () => {
    const response = await fetchChecked(url, init, options.signal);
    return response.blob();
  }, options);
}
