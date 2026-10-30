export interface NotionSettings {
  apiKey: string;
  databaseId: string;
  version: string;
}

export interface SyncSettings {
  limit: number;
  checkNotionDuplicates: boolean;
  embedPromptMetadata: boolean;
}

export interface Settings {
  notion: NotionSettings;
  sync: SyncSettings;
  notifyOnFinish: boolean;
}

export interface AuthSession {
  token: string;
  capturedAt: number;
  lastSeenAt: number;
  expiresAt?: number;
  email?: string;
  userAgent?: string;
}

export interface AuthStatus {
  present: boolean;
  expiresAt?: number;
  capturedAt?: number;
  lastSeenAt?: number;
  email?: string;
  userAgent?: string;
}

export type GenerationStatus = 'pending' | 'uploaded' | 'failed';

export interface GenerationRecord {
  id: string;
  conversationId: string;
  messageId: string;
  assetPointer: string;
  url: string;
  prompt: string;
  createdAt: string;
  fileName: string;
  status: GenerationStatus;
  uploadedAt?: string;
  lastError?: string;
  attempts: number;
  lastAttemptAt?: string;
}

export type SyncPhase =
  | 'idle'
  | 'discovering'
  | 'processing'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'interrupted';

export type RunErrorStage =
  | 'run'
  | 'notion_check'
  | 'download'
  | 'prompt'
  | 'upload'
  | 'library_scan'
  | 'library_delete';

export interface RunError {
  id: string;
  fileName: string;
  stage: RunErrorStage;
  message: string;
  at: string;
}

export interface SyncState {
  running: boolean;
  phase: SyncPhase;
  runId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  discovered: number;
  total: number;
  current: number;
  uploaded: number;
  skipped: number;
  failed: number;
  message: string;
  errors: RunError[];
}

export interface SyncRunRecord {
  id: string;
  startedAt: number;
  finishedAt: number;
  phase: SyncPhase;
  discovered: number;
  uploaded: number;
  skipped: number;
  failed: number;
  errors: RunError[];
  email?: string;
}

export interface NotionCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface NotionTestResult {
  ok: boolean;
  checks: NotionCheck[];
  error?: string;
}

export interface LibraryItem {
  id: string;
  fileId: string;
  parentDirectoryId: string;
  name: string;
}

export interface LibraryScanResult {
  items: LibraryItem[];
  total: number;
}

export type LibraryPhase =
  | 'idle'
  | 'scanning'
  | 'deleting'
  | 'done'
  | 'error'
  | 'cancelled';

export interface LibraryState {
  running: boolean;
  phase: LibraryPhase;
  runId: string | null;
  query: string;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  deleted: number;
  failed: number;
  message: string;
  errors: RunError[];
}

export interface LibraryRunRecord {
  id: string;
  startedAt: number;
  finishedAt: number;
  phase: LibraryPhase;
  query: string;
  total: number;
  deleted: number;
  failed: number;
  errors: RunError[];
}
