import { browser } from 'wxt/browser';
import type { AuthSession, AuthStatus } from './types';
import { decodeJwtPayload, extractEmailFromJwt } from './util';

const AUTH_KEY = 'authSession';
const DEFAULT_TOKEN_LIFETIME_MS = 55 * 60 * 1000;
const EXPIRY_SKEW_MS = 30 * 1000;

function sessionArea() {
  return browser.storage.session ?? browser.storage.local;
}

export function normalizeBearerToken(raw: string): string {
  return raw
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim();
}

export function isTokenShaped(token: string): boolean {
  return token.length >= 20 && token.length <= 8192 && !/\s/.test(token);
}

export async function getAuthSession(): Promise<AuthSession | undefined> {
  const stored = await sessionArea().get(AUTH_KEY);
  return stored[AUTH_KEY] as AuthSession | undefined;
}

export async function saveObservedToken(
  rawToken: string,
  userAgent?: string,
  capturedAt = Date.now(),
): Promise<AuthSession | null> {
  const token = normalizeBearerToken(rawToken);
  if (!isTokenShaped(token)) {
    return null;
  }

  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  const expiresAt =
    typeof exp === 'number' && Number.isFinite(exp)
      ? exp * 1000
      : capturedAt + DEFAULT_TOKEN_LIFETIME_MS;
  const email = extractEmailFromJwt(payload);
  const existing = await getAuthSession();

  if (existing?.token === token) {
    const updated: AuthSession = {
      ...existing,
      lastSeenAt: Date.now(),
      userAgent: userAgent ?? existing.userAgent,
      email: email ?? existing.email,
    };
    await sessionArea().set({ [AUTH_KEY]: updated });
    return updated;
  }

  const session: AuthSession = {
    token,
    capturedAt,
    lastSeenAt: Date.now(),
    expiresAt,
    email: email ?? existing?.email,
    userAgent,
  };
  await sessionArea().set({ [AUTH_KEY]: session });
  return session;
}

export async function setAuthEmail(email: string): Promise<void> {
  const session = await getAuthSession();
  if (!session) {
    return;
  }
  await sessionArea().set({ [AUTH_KEY]: { ...session, email } });
}

export async function clearAuthSession(): Promise<void> {
  await sessionArea().remove(AUTH_KEY);
}

export function isSessionUsable(
  session: AuthSession | undefined,
): session is AuthSession {
  if (!session?.token) {
    return false;
  }
  if (!session.expiresAt) {
    return true;
  }
  return session.expiresAt - EXPIRY_SKEW_MS > Date.now();
}

export async function getUsableAuthSession(): Promise<AuthSession | null> {
  const session = await getAuthSession();
  return isSessionUsable(session) ? session : null;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const session = await getAuthSession();
  if (!session) {
    return { present: false };
  }
  return {
    present: isSessionUsable(session),
    expiresAt: session.expiresAt,
    capturedAt: session.capturedAt,
    lastSeenAt: session.lastSeenAt,
    email: session.email,
    userAgent: session.userAgent,
  };
}
