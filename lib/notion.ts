import { requestWithRetry, HttpError } from './retry';
import { deleteMeta, getMeta, setMeta } from './storage';
import type { NotionCheck, NotionTestResult } from './types';
import { contentTypeForFileName, errorMessage, parseNotionDatabaseId } from './util';

export const NOTION_BASE_URL = 'https://api.notion.com';
const DATA_SOURCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class NotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotionError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pageTitle(page: unknown): string {
  const properties = asRecord(asRecord(page)?.properties);
  const title = asArray(asRecord(properties?.Name)?.title);
  let out = '';
  for (const part of title) {
    const text = asString(asRecord(part)?.plain_text) ?? asString(asRecord(asRecord(part)?.text)?.content);
    if (!text) {
      throw new NotionError('Notion page is missing Name title text');
    }
    out += text;
  }
  return out;
}

export function buildPagePayload(
  databaseId: string,
  fileName: string,
  prompt: string,
  email: string | undefined,
): Record<string, unknown> {
  const normalized = prompt.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let markdown = `**Prompt:**\n\n\`\`\`\n${normalized}\n\`\`\``;
  if (email) {
    markdown += `\n\n**Email:** ${email}`;
  }
  return {
    parent: { database_id: databaseId },
    properties: {
      Name: { title: [{ text: { content: fileName } }] },
      Image: {
        files: [{ type: 'file_upload', file_upload: { id: '' } }],
      },
    },
    markdown,
  };
}

export class NotionClient {
  private readonly token: string;
  private readonly version: string;
  private readonly baseUrl: string;

  constructor(token: string, version: string, baseUrl = NOTION_BASE_URL) {
    this.token = token;
    this.version = version;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private headers(json = true): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      'Notion-Version': this.version,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private async jsonRequest(
    path: string,
    init: RequestInit,
    signal: AbortSignal,
    retryOn?: (error: unknown) => boolean,
  ): Promise<unknown> {
    const response = await requestWithRetry(
      `${this.baseUrl}${path}`,
      {
        ...init,
        headers: { ...this.headers(), ...(init.headers ?? {}) },
      },
      { signal, retryOn },
    );
    return response.json();
  }

  async getDatabase(databaseId: string, signal: AbortSignal): Promise<unknown> {
    return this.jsonRequest(`/v1/databases/${encodeURIComponent(databaseId)}`, { method: 'GET' }, signal);
  }

  async getDataSource(dataSourceId: string, signal: AbortSignal): Promise<unknown> {
    return this.jsonRequest(
      `/v1/data_sources/${encodeURIComponent(dataSourceId)}`,
      { method: 'GET' },
      signal,
    );
  }

  private async fetchDataSources(databaseId: string, signal: AbortSignal): Promise<string[]> {
    const database = asRecord(await this.getDatabase(databaseId, signal));
    const ids = asArray(database?.data_sources)
      .map((item) => asString(asRecord(item)?.id))
      .filter((id): id is string => Boolean(id));
    if (!ids.length) {
      throw new NotionError(
        `Notion database ${databaseId} has no data sources. Upgrade the Notion API version or reconnect the integration.`,
      );
    }
    return ids;
  }

  async getDataSources(databaseId: string, signal: AbortSignal): Promise<string[]> {
    const cacheKey = `notion:dataSources:${databaseId}`;
    const cached = await getMeta<{ ids?: unknown; expiresAt?: unknown }>(cacheKey);
    if (
      cached &&
      Array.isArray(cached.ids) &&
      cached.ids.every((id) => typeof id === 'string') &&
      typeof cached.expiresAt === 'number' &&
      cached.expiresAt > Date.now()
    ) {
      if (cached.ids.length) {
        return cached.ids as string[];
      }
      await deleteMeta(cacheKey);
    }

    const ids = await this.fetchDataSources(databaseId, signal);
    await setMeta(cacheKey, { ids, expiresAt: Date.now() + DATA_SOURCE_CACHE_TTL_MS });
    return ids;
  }

  private async queryDataSource(
    dataSourceId: string,
    name: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    const payload: Record<string, unknown> = {
      filter: {
        and: [{ property: 'Name', title: { equals: name } }],
      },
    };
    if (cursor) {
      payload.start_cursor = cursor;
    }
    return this.jsonRequest(
      `/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`,
      { method: 'POST', body: JSON.stringify(payload) },
      signal,
    );
  }

  private async queryDataSourceForPage(
    dataSourceId: string,
    name: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (;;) {
      const data = asRecord(
        await this.queryDataSource(dataSourceId, name, cursor, signal),
      );
      const results = asArray(data?.results);
      for (const page of results) {
        if (pageTitle(page) === name) {
          return true;
        }
      }
      if (data?.has_more !== true) {
        return false;
      }
      const next = asString(data.next_cursor);
      if (!next || seen.has(next)) {
        throw new NotionError('Notion pagination returned an invalid next_cursor');
      }
      seen.add(next);
      cursor = next;
    }
  }

  async isPageExists(
    databaseId: string,
    fileName: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const sources = await this.getDataSources(databaseId, signal);
    for (const source of sources) {
      if (await this.queryDataSourceForPage(source, fileName, signal)) {
        return true;
      }
    }
    return false;
  }

  async validateDatabase(databaseId: string, signal: AbortSignal): Promise<NotionTestResult> {
    const normalized = parseNotionDatabaseId(databaseId);
    if (!normalized) {
      return {
        ok: false,
        checks: [{ label: 'Database ID', ok: false, detail: 'Invalid database ID.' }],
        error: 'Notion database ID is invalid.',
      };
    }

    const checks: NotionCheck[] = [];
    let database: unknown;
    try {
      database = await this.getDatabase(normalized, signal);
      checks.push({ label: 'Database access', ok: true });
    } catch (error) {
      return {
        ok: false,
        checks: [{ label: 'Database access', ok: false, detail: errorMessage(error) }],
        error: `Cannot access Notion database: ${errorMessage(error)}`,
      };
    }

    const sources = asArray(asRecord(database)?.data_sources)
      .map((item) => asString(asRecord(item)?.id))
      .filter((id): id is string => Boolean(id));
    if (!sources.length) {
      checks.push({
        label: 'Data sources',
        ok: false,
        detail: 'The database has no data sources.',
      });
      return { ok: false, checks, error: 'Notion database has no data sources.' };
    }
    checks.push({ label: 'Data sources', ok: true, detail: `${sources.length} found` });

    for (const sourceId of sources) {
      try {
        const source = asRecord(await this.getDataSource(sourceId, signal));
        const properties = asRecord(source?.properties);
        const nameProperty = asRecord(properties?.Name);
        const imageProperty = asRecord(properties?.Image);
        checks.push({
          label: `Name property (${sourceId.slice(0, 8)})`,
          ok: nameProperty?.type === 'title',
          detail: nameProperty?.type === 'title' ? 'Title property' : 'Expected a Title property named Name.',
        });
        checks.push({
          label: `Image property (${sourceId.slice(0, 8)})`,
          ok: imageProperty?.type === 'files',
          detail: imageProperty?.type === 'files' ? 'Files property' : 'Expected a Files property named Image.',
        });
      } catch (error) {
        checks.push({
          label: `Data source ${sourceId.slice(0, 8)}`,
          ok: false,
          detail: errorMessage(error),
        });
      }
    }

    return { ok: checks.every((check) => check.ok), checks };
  }

  private async createUpload(
    fileName: string,
    contentType: string,
    signal: AbortSignal,
  ): Promise<string> {
    const data = asRecord(
      await this.jsonRequest(
        '/v1/file_uploads',
        {
          method: 'POST',
          body: JSON.stringify({
            mode: 'single_part',
            filename: fileName,
            content_type: contentType,
          }),
        },
        signal,
      ),
    );
    const id = asString(data?.id);
    if (!id) {
      throw new NotionError('Notion file upload response is missing an id');
    }
    return id;
  }

  private async sendUpload(
    uploadId: string,
    fileName: string,
    blob: Blob,
    contentType: string,
    signal: AbortSignal,
  ): Promise<string> {
    const form = new FormData();
    form.append('file', blob, fileName);
    try {
      const response = await requestWithRetry(
        `${this.baseUrl}/v1/file_uploads/${encodeURIComponent(uploadId)}/send`,
        {
          method: 'POST',
          headers: this.headers(false),
          body: form,
        },
        { signal },
      );
      const data = asRecord(await response.json());
      return asString(data?.id) ?? uploadId;
    } catch (error) {
      // c2n treats a 400 here as "already uploaded" so retries are safe.
      if (error instanceof HttpError && error.status === 400) {
        return uploadId;
      }
      throw error;
    }
  }

  async addPageToDatabase(
    databaseId: string,
    fileName: string,
    blob: Blob,
    prompt: string,
    email: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const normalizedDatabaseId = parseNotionDatabaseId(databaseId);
    if (!normalizedDatabaseId) {
      throw new NotionError('Invalid Notion database ID');
    }
    const contentType = contentTypeForFileName(fileName);
    const uploadId = await this.createUpload(fileName, contentType, signal);
    const finalUploadId = await this.sendUpload(uploadId, fileName, blob, contentType, signal);
    const payload = buildPagePayload(normalizedDatabaseId, fileName, prompt, email);
    const properties = asRecord(payload.properties);
    const image = asRecord(properties?.Image);
    const files = asArray(image?.files);
    const file = asRecord(files[0]);
    const fileUpload = asRecord(file?.file_upload);
    if (fileUpload) {
      fileUpload.id = finalUploadId;
    }

    await this.jsonRequest(
      '/v1/pages',
      { method: 'POST', body: JSON.stringify(payload) },
      signal,
      (error) => error instanceof HttpError && error.status === 429,
    ).catch(async (error: unknown) => {
      if (isAmbiguousPageCreateError(error)) {
        try {
          if (await this.isPageExists(normalizedDatabaseId, fileName, signal)) {
            return;
          }
        } catch {
          // Fall through to the original error.
        }
      }
      throw error;
    });
  }
}

function isAmbiguousPageCreateError(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status >= 500;
  }
  return error instanceof TypeError;
}
