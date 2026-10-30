import { describe, expect, it } from 'vitest';
import { shouldRedirectToChatGPT } from '@/lib/popup-redirect';

describe('shouldRedirectToChatGPT', () => {
  it('returns false for chatgpt.com URLs', () => {
    expect(shouldRedirectToChatGPT('https://chatgpt.com/')).toBe(false);
    expect(shouldRedirectToChatGPT('https://chatgpt.com:8443/')).toBe(false);
    expect(shouldRedirectToChatGPT('https://chatgpt.com:8443/c/abc')).toBe(
      false,
    );
    expect(shouldRedirectToChatGPT('https://ChatGPT.com/')).toBe(false);
    expect(shouldRedirectToChatGPT('https://www.chatgpt.com/feed')).toBe(false);
    expect(shouldRedirectToChatGPT('https://help.chatgpt.com/x')).toBe(false);
  });

  it('returns true for non-chatgpt sites and blank tabs', () => {
    expect(shouldRedirectToChatGPT('https://notion.so/')).toBe(true);
    expect(shouldRedirectToChatGPT('https://example.com')).toBe(true);
    expect(shouldRedirectToChatGPT('chrome://newtab/')).toBe(true);
    expect(shouldRedirectToChatGPT(undefined)).toBe(true);
  });

  it('does not match sibling domains or non-https', () => {
    expect(shouldRedirectToChatGPT('https://chatgpt.com.evil.com/')).toBe(true);
    expect(shouldRedirectToChatGPT('http://chatgpt.com/')).toBe(true);
    expect(shouldRedirectToChatGPT('https://evil-chatgpt.com/')).toBe(true);
  });
});
