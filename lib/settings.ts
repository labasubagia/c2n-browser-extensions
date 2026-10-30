import { browser } from 'wxt/browser';
import type { Settings } from './types';
import { parseNotionDatabaseId } from './util';

export const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  notion: {
    apiKey: '',
    databaseId: '',
    version: '2025-09-03',
  },
  sync: {
    limit: 100,
    checkNotionDuplicates: true,
    embedPromptMetadata: true,
    deleteConversationsAfterSync: false,
  },
  notifyOnFinish: true,
};

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
  return normalizeSettings({
    notion: { ...DEFAULT_SETTINGS.notion, ...(value?.notion ?? {}) },
    sync: { ...DEFAULT_SETTINGS.sync, ...(value?.sync ?? {}) },
    notifyOnFinish: value?.notifyOnFinish ?? DEFAULT_SETTINGS.notifyOnFinish,
  });
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const normalized = normalizeSettings(settings);
  await browser.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

export function normalizeSettings(settings: Settings): Settings {
  const databaseId =
    parseNotionDatabaseId(settings.notion.databaseId) ??
    settings.notion.databaseId.trim();
  const limit = Math.round(Number(settings.sync.limit));
  return {
    notion: {
      apiKey: settings.notion.apiKey.trim(),
      databaseId,
      version:
        settings.notion.version.trim() || DEFAULT_SETTINGS.notion.version,
    },
    sync: {
      limit: Number.isFinite(limit)
        ? Math.min(500, Math.max(1, limit))
        : DEFAULT_SETTINGS.sync.limit,
      checkNotionDuplicates: Boolean(settings.sync.checkNotionDuplicates),
      embedPromptMetadata: Boolean(settings.sync.embedPromptMetadata),
      deleteConversationsAfterSync: Boolean(
        settings.sync.deleteConversationsAfterSync,
      ),
    },
    notifyOnFinish: Boolean(settings.notifyOnFinish),
  };
}

export function isNotionConfigured(settings: Settings): boolean {
  return Boolean(
    settings.notion.apiKey && parseNotionDatabaseId(settings.notion.databaseId),
  );
}

export function validateSettings(settings: Settings): string[] {
  const errors: string[] = [];
  if (!settings.notion.apiKey.trim()) {
    errors.push('Notion integration token is required.');
  }
  if (!parseNotionDatabaseId(settings.notion.databaseId)) {
    errors.push(
      'Notion database ID must be a 32-character ID or a full Notion database URL.',
    );
  }
  if (!settings.notion.version.trim()) {
    errors.push('Notion API version is required.');
  }
  if (
    !Number.isFinite(settings.sync.limit) ||
    settings.sync.limit < 1 ||
    settings.sync.limit > 500
  ) {
    errors.push('Sync limit must be between 1 and 500.');
  }
  return errors;
}
