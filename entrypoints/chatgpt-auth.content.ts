import { defineContentScript } from 'wxt/utils/define-content-script';

const OUTBOUND_SOURCE = 'c2n-auth';
const INBOUND_SOURCE = 'c2n-bridge';
const RESEND_INTERVAL_MS = 5 * 60 * 1000;

function isChatGptApiUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl, location.href);
    return (
      (url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com')) &&
      (url.pathname === '/backend-api' || url.pathname.startsWith('/backend-api/'))
    );
  } catch {
    return false;
  }
}

function readHeader(headers: HeadersInit | undefined, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }
  const wanted = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (Array.isArray(headers)) {
    for (const pair of headers) {
      if (Array.isArray(pair) && String(pair[0]).toLowerCase() === wanted) {
        return pair[1] === undefined ? undefined : String(pair[1]);
      }
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }
  return undefined;
}

function normalizeToken(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const token = raw.trim().replace(/^Bearer\s+/i, '').trim();
  if (token.length < 20 || token.length > 8192 || /\s/.test(token)) {
    return undefined;
  }
  return token;
}

/**
 * Runs in the page's MAIN world because Chrome's webRequest API hides the
 * `Authorization` header from extensions. Wrapping fetch/XHR is the only way
 * to observe the bearer token ChatGPT already sends from its own tab.
 */
export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://*.chatgpt.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const guard = window as unknown as { __c2nAuthPatched?: boolean };
    if (guard.__c2nAuthPatched) {
      return;
    }
    guard.__c2nAuthPatched = true;

    let latestToken = '';
    let lastSentAt = 0;

    const report = (rawToken: string | undefined): void => {
      const token = normalizeToken(rawToken);
      if (!token) {
        return;
      }
      const now = Date.now();
      if (token === latestToken && now - lastSentAt < RESEND_INTERVAL_MS) {
        return;
      }
      latestToken = token;
      lastSentAt = now;
      window.postMessage(
        {
          source: OUTBOUND_SOURCE,
          type: 'token',
          token,
          userAgent: navigator.userAgent,
        },
        location.origin,
      );
    };

    const originalFetch = window.fetch;
    window.fetch = function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      try {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : typeof Request !== 'undefined' && input instanceof Request
                ? input.url
                : String(input);
        if (isChatGptApiUrl(url)) {
          const authorization =
            readHeader(init?.headers, 'authorization') ??
            (typeof Request !== 'undefined' && input instanceof Request
              ? (input.headers.get('authorization') ?? undefined)
              : undefined);
          report(authorization);
        }
      } catch {
        // Never break the page because of token observation.
      }
      return originalFetch(input, init);
    };

    const xhrState = new WeakMap<XMLHttpRequest, { url: string; authorization?: string }>();
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(
      this: XMLHttpRequest,
      ...args: unknown[]
    ): void {
      try {
        xhrState.set(this, { url: String(args[1] ?? '') });
      } catch {
        // Ignore.
      }
      (originalOpen as (...openArgs: unknown[]) => void).apply(this, args);
    };

    XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(
      this: XMLHttpRequest,
      name: string,
      value: string,
    ): void {
      try {
        const state = xhrState.get(this);
        if (state && String(name).toLowerCase() === 'authorization') {
          state.authorization = value;
        }
      } catch {
        // Ignore.
      }
      originalSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function patchedSend(
      this: XMLHttpRequest,
      ...args: unknown[]
    ): void {
      try {
        const state = xhrState.get(this);
        if (state && isChatGptApiUrl(state.url)) {
          report(state.authorization);
        }
      } catch {
        // Ignore.
      }
      (originalSend as (...sendArgs: unknown[]) => void).apply(this, args);
    };

    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== location.origin) {
        return;
      }
      const data = event.data as { source?: unknown; type?: unknown } | null;
      if (!data || data.source !== INBOUND_SOURCE || data.type !== 'request-token') {
        return;
      }
      if (latestToken) {
        lastSentAt = Date.now();
        window.postMessage(
          {
            source: OUTBOUND_SOURCE,
            type: 'token',
            token: latestToken,
            userAgent: navigator.userAgent,
          },
          location.origin,
        );
      }
    });
  },
});
