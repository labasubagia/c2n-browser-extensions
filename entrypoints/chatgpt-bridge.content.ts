import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';

const OUTBOUND_SOURCE = 'c2n-auth';
const INBOUND_SOURCE = 'c2n-bridge';
const RESEND_INTERVAL_MS = 60_000;

function isTokenShaped(token: string): boolean {
  return (
    token.length >= 20 &&
    token.length <= 8192 &&
    !/\s/.test(token)
  );
}

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://*.chatgpt.com/*'],
  runAt: 'document_start',
  main() {
    const guard = window as unknown as { __c2nBridgeStarted?: boolean };
    if (guard.__c2nBridgeStarted) {
      return;
    }
    guard.__c2nBridgeStarted = true;

    let lastToken = '';
    let lastSentAt = 0;

    const forward = (token: string, userAgent: string | undefined): void => {
      if (!isTokenShaped(token)) {
        return;
      }
      const now = Date.now();
      if (token === lastToken && now - lastSentAt < RESEND_INTERVAL_MS) {
        return;
      }
      lastToken = token;
      lastSentAt = now;
      void browser.runtime
        .sendMessage({
          type: 'AUTH_TOKEN_OBSERVED',
          token,
          userAgent: userAgent ?? navigator.userAgent,
        })
        .catch(() => {
          // The worker may be restarting; allow the next request to retry.
          if (lastToken === token) {
            lastSentAt = 0;
          }
        });
    };

    const requestCachedToken = (): void => {
      window.postMessage({ source: INBOUND_SOURCE, type: 'request-token' }, location.origin);
    };

    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== location.origin) {
        return;
      }
      const data = event.data as
        | { source?: unknown; type?: unknown; token?: unknown; userAgent?: unknown }
        | null;
      if (!data || data.source !== OUTBOUND_SOURCE || data.type !== 'token') {
        return;
      }
      if (typeof data.token !== 'string') {
        return;
      }
      forward(data.token, typeof data.userAgent === 'string' ? data.userAgent : undefined);
    });

    requestCachedToken();
    window.addEventListener('pageshow', requestCachedToken);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestCachedToken();
      }
    });
  },
});
