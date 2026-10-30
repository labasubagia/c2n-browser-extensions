export const CHATGPT_URL_RE =
  /^https:\/\/([\w-]+\.)*chatgpt\.com(?::\d+)?(?:\/|$)/i;

export function shouldRedirectToChatGPT(tabUrl: string | undefined): boolean {
  return !tabUrl || !CHATGPT_URL_RE.test(tabUrl);
}
