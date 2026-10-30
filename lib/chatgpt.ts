import { HttpError, requestBlobWithRetry, requestWithRetry } from './retry';
import type { LibraryItem } from './types';
import {
  extractEmailFromUnknown,
  fileNameForGeneration,
  timestampToIso,
} from './util';

export const CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api';

const IMAGE_HOSTS: Record<string, true> = {
  'chatgpt.com': true,
  'oaiusercontent.com': true,
  'openai.com': true,
};

/**
 * ChatGPT image generation URLs are signed CDN links. Restrict downloads to
 * HTTPS and the same hosts as `host_permissions` so a compromised/malicious
 * API response cannot point the extension at file://, local/private network
 * addresses, or other allowed-but-unintended origins.
 */
export function isAllowedImageUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return (
      IMAGE_HOSTS[host] === true ||
      host.endsWith('.chatgpt.com') ||
      host.endsWith('.oaiusercontent.com') ||
      host.endsWith('.openai.com')
    );
  } catch {
    return false;
  }
}

export interface ImageGenItem {
  id: string;
  messageId: string;
  assetPointer: string;
  conversationId: string;
  url: string;
  createdAt: number;
}

export interface LibraryImagesResponse {
  items: LibraryItem[];
  cursor?: string;
}

interface RawImageGenItem {
  id?: unknown;
  message_id?: unknown;
  asset_pointer?: unknown;
  conversation_id?: unknown;
  url?: unknown;
  created_at?: unknown;
}

interface RawLibraryItem {
  id?: unknown;
  file_id?: unknown;
  parent_directory_id?: unknown;
  name?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function normalizeImageGenItem(
  raw: RawImageGenItem,
): ImageGenItem | null {
  const id = asString(raw.id);
  const messageId = asString(raw.message_id);
  const assetPointer = asString(raw.asset_pointer);
  const conversationId = asString(raw.conversation_id);
  const url = asString(raw.url);
  const createdAt = asNumber(raw.created_at);
  if (!id || !conversationId || !url || createdAt === undefined) {
    return null;
  }
  return {
    id,
    messageId: messageId ?? '',
    assetPointer: assetPointer ?? '',
    conversationId,
    url,
    createdAt,
  };
}

function chatGptHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

export async function getRecentImageGenerations(
  token: string,
  limit: number,
  signal: AbortSignal,
): Promise<ImageGenItem[]> {
  const url = new URL(`${CHATGPT_BASE_URL}/my/recent/image_gen`);
  url.searchParams.set('limit', String(limit));
  const response = await requestWithRetry(
    url.toString(),
    { method: 'GET', headers: chatGptHeaders(token), credentials: 'include' },
    { signal },
  );
  const data = (await response.json()) as { items?: unknown } | undefined;
  const items = Array.isArray(data?.items) ? data.items : [];
  return items
    .map((item) => normalizeImageGenItem((item ?? {}) as RawImageGenItem))
    .filter((item): item is ImageGenItem => Boolean(item));
}

export async function getConversation(
  token: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await requestWithRetry(
    `${CHATGPT_BASE_URL}/conversation/${encodeURIComponent(conversationId)}`,
    { method: 'GET', headers: chatGptHeaders(token), credentials: 'include' },
    { signal },
  );
  return response.json();
}

export async function downloadImage(
  token: string,
  rawUrl: string,
  signal: AbortSignal,
): Promise<Blob> {
  if (!isAllowedImageUrl(rawUrl)) {
    throw new Error('Unsafe image URL');
  }
  const url = new URL(rawUrl);
  const isChatGpt = url.origin === 'https://chatgpt.com';
  const headers: HeadersInit = isChatGpt
    ? { Authorization: `Bearer ${token}`, Accept: 'image/*' }
    : { Accept: 'image/*' };
  return requestBlobWithRetry(
    url.toString(),
    {
      method: 'GET',
      headers,
      credentials: isChatGpt ? 'include' : 'omit',
    },
    { signal },
  );
}

export async function getMe(
  token: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const response = await requestWithRetry(
    `${CHATGPT_BASE_URL}/me`,
    { method: 'GET', headers: chatGptHeaders(token), credentials: 'include' },
    { signal },
  );
  const data = await response.json();
  return extractEmailFromUnknown(data);
}

function normalizeLibraryItem(raw: RawLibraryItem): LibraryItem | null {
  const id = asString(raw.id);
  const fileId = asString(raw.file_id);
  const parentDirectoryId = asString(raw.parent_directory_id);
  const name = asString(raw.name);
  if (!id || !fileId || !parentDirectoryId || !name) {
    return null;
  }
  return { id, fileId, parentDirectoryId, name };
}

export async function getLibraryImages(
  token: string,
  query: string | undefined,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<LibraryImagesResponse> {
  const url = new URL(`${CHATGPT_BASE_URL}/files/library/nodes`);
  url.searchParams.set('categories', 'image');
  if (query?.trim()) {
    url.searchParams.set('q', query.trim());
  }
  if (cursor) {
    url.searchParams.set('cursor', cursor);
  }
  const response = await requestWithRetry(
    url.toString(),
    { method: 'GET', headers: chatGptHeaders(token), credentials: 'include' },
    { signal },
  );
  const data = (await response.json()) as
    | { items?: unknown; cursor?: unknown }
    | undefined;
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    items: items
      .map((item) => normalizeLibraryItem((item ?? {}) as RawLibraryItem))
      .filter((item): item is LibraryItem => Boolean(item)),
    cursor: asString(data?.cursor),
  };
}

export async function deleteLibraryFile(
  token: string,
  item: LibraryItem,
  signal: AbortSignal,
): Promise<unknown[]> {
  const url = new URL(
    `${CHATGPT_BASE_URL}/files/library/files/${encodeURIComponent(item.id)}/delete_stream`,
  );
  url.searchParams.set('file_id', item.fileId);
  url.searchParams.set('parent_directory_id', item.parentDirectoryId);
  url.searchParams.set('file_name', item.name);
  url.searchParams.set('soft_delete', 'true');

  try {
    const response = await requestWithRetry(
      url.toString(),
      {
        method: 'POST',
        headers: chatGptHeaders(token),
        credentials: 'include',
      },
      { signal },
    );
    return parseSseEvents(await response.text());
  } catch (error) {
    if (
      error instanceof Error &&
      'status' in error &&
      (error as { status?: number }).status === 404
    ) {
      return [];
    }
    throw error;
  }
}

export async function deleteConversation(
  token: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await requestWithRetry(
      `${CHATGPT_BASE_URL}/conversation/${encodeURIComponent(conversationId)}`,
      {
        method: 'PATCH',
        headers: {
          ...chatGptHeaders(token),
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ is_visible: false }),
      },
      { signal },
    );
  } catch (error) {
    // A conversation already deleted by another run surfaces as a 404 carrying
    // `conversation_deleted`; treat it as already handled (matches c2n).
    if (
      error instanceof HttpError &&
      error.status === 404 &&
      error.body.includes('conversation_deleted')
    ) {
      return;
    }
    throw error;
  }
}

export function getConversationMappingKeyByAssetPointer(
  data: unknown,
  assetPointer: string,
): string | undefined {
  const mapping = asRecord(asRecord(data)?.mapping);
  if (!mapping) {
    return undefined;
  }
  for (const [key, value] of Object.entries(mapping)) {
    const node = asRecord(value);
    const message = asRecord(node?.message);
    const content = asRecord(message?.content);
    const parts = content?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    if (parts.some((part) => asRecord(part)?.asset_pointer === assetPointer)) {
      return key;
    }
  }
  return undefined;
}

/**
 * Walk parent links from an image node to the user message that produced it.
 */
export function getPromptFromImageNodeInConversation(
  data: unknown,
  startNodeId: string,
  assetPointer: string,
): string | undefined {
  const mapping = asRecord(asRecord(data)?.mapping);
  if (!mapping) {
    return undefined;
  }

  let currentId = Object.hasOwn(mapping, startNodeId)
    ? startNodeId
    : getConversationMappingKeyByAssetPointer(data, assetPointer);
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = asRecord(mapping[currentId]);
    const message = asRecord(node?.message);
    const author = asRecord(message?.author);
    if (author?.role === 'user') {
      const content = asRecord(message?.content);
      const parts = content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (typeof part === 'string') {
            return part;
          }
        }
      }
    }
    currentId = asString(node?.parent);
  }
  return undefined;
}

export function parseSseEvents(body: string): unknown[] {
  const events: unknown[] = [];
  for (const block of body.split('\n\n')) {
    const payload: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.startsWith('data: ')) {
        payload.push(line.slice(6));
      } else if (
        line.startsWith('event: ') ||
        line.startsWith('id: ') ||
        line.startsWith('retry: ')
      ) {
      } else if (line) {
        payload.push(line);
      }
    }
    if (payload.length) {
      pushJson(events, payload.join(''));
    }
  }

  if (!events.length && body) {
    for (const line of body.split('\n')) {
      pushJson(events, line);
    }
  }
  return events;
}

function pushJson(events: unknown[], raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '[DONE]') {
    return;
  }
  try {
    events.push(JSON.parse(trimmed));
  } catch {
    // Ignore malformed events, matching c2n's tolerant SSE parser.
  }
}

export { fileNameForGeneration, timestampToIso };
