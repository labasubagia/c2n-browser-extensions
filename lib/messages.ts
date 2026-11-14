import { browser } from 'wxt/browser';
import type {
  AuthStatus,
  GenerationEstimate,
  LibraryItem,
  LibraryState,
  NotionTestResult,
  Settings,
  SyncRunRecord,
  SyncState,
} from './types';

export interface RuntimeStatus {
  auth: AuthStatus;
  settings: Settings;
  notionConfigured: boolean;
  pending: number;
  sync: SyncState;
  library: LibraryState;
  lastRun?: SyncRunRecord;
  scan: { query: string; count: number; scannedAt: number } | null;
  version: string;
}

export interface ScanResponse {
  ok: boolean;
  items: LibraryItem[];
  total: number;
  error?: string;
}
export interface GenerationLimitInfo {
  ok: boolean;
  error?: string;
  estimate?: GenerationEstimate;
  at: number;
}
export interface SyncedGenerationSummary {
  id: string;
  fileName: string;
  url: string;
  prompt: string;
  createdAt?: string;
  uploadedAt?: string;
  lastSyncedAt?: string;
}

export interface SyncedGenerationsResponse {
  ok: boolean;
  items: SyncedGenerationSummary[];
  error?: string;
}

export type ExtensionMessage =
  | { type: 'AUTH_TOKEN_OBSERVED'; token: string; userAgent?: string }
  | { type: 'GET_STATUS' }
  | { type: 'GET_LIMIT' }
  | { type: 'GET_SYNCED_GENERATIONS'; limit: number }
  | { type: 'START_SYNC'; resume?: boolean }
  | { type: 'CANCEL_SYNC' }
  | { type: 'TEST_NOTION' }
  | { type: 'SCAN_LIBRARY'; query: string }
  | { type: 'DELETE_LIBRARY' }
  | { type: 'CANCEL_LIBRARY' }
  | { type: 'CLEAR_LIBRARY_SCAN' }
  | { type: 'FORGET_AUTH' }
  | { type: 'STATE_UPDATE'; sync: SyncState; library: LibraryState };

export interface ResponseMap {
  GET_STATUS: RuntimeStatus;
  GET_LIMIT: GenerationLimitInfo;
  GET_SYNCED_GENERATIONS: SyncedGenerationsResponse;
  START_SYNC: { ok: boolean; error?: string };
  CANCEL_SYNC: { ok: boolean };
  TEST_NOTION: NotionTestResult;
  SCAN_LIBRARY: ScanResponse;
  DELETE_LIBRARY: { ok: boolean; error?: string };
  CANCEL_LIBRARY: { ok: boolean };
  CLEAR_LIBRARY_SCAN: { ok: boolean };
  FORGET_AUTH: { ok: boolean };
  AUTH_TOKEN_OBSERVED: { ok: boolean };
}

export function sendMessage<T extends keyof ResponseMap>(
  message: Extract<ExtensionMessage, { type: T }>,
): Promise<ResponseMap[T]> {
  return browser.runtime.sendMessage(message) as Promise<ResponseMap[T]>;
}

export function isStateUpdate(
  message: unknown,
): message is Extract<ExtensionMessage, { type: 'STATE_UPDATE' }> {
  return Boolean(
    message &&
      typeof message === 'object' &&
      (message as { type?: unknown }).type === 'STATE_UPDATE',
  );
}

export function openPage(
  path: 'options.html' | 'library.html' | 'history.html',
): void {
  void browser.tabs.create({ url: browser.runtime.getURL(`/${path}`) });
}

export function openOptionsPage(): void {
  void browser.runtime.openOptionsPage();
}
