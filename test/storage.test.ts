import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGenerations,
  clearNotionCache,
  getGeneration,
  getGenerationsByIds,
  getMeta,
  getPendingCount,
  getPendingGenerations,
  markGenerationFailed,
  markGenerationUploaded,
  putGeneration,
  setMeta,
} from '@/lib/storage';
import type { GenerationRecord } from '@/lib/types';

function record(id: string, status: GenerationRecord['status'], createdAt: string): GenerationRecord {
  return {
    id,
    conversationId: 'conv',
    messageId: 'msg',
    assetPointer: `file-service://${id}`,
    url: `https://example.test/${id}.png`,
    prompt: 'prompt',
    createdAt,
    fileName: `${id}.png`,
    status,
    attempts: 0,
  };
}

beforeEach(async () => {
  await clearGenerations();
});

describe('generation storage', () => {
  it('round-trips a generation', async () => {
    await putGeneration(record('gen-1', 'pending', '2026-01-01T00:00:00.000Z'));
    expect(await getGeneration('gen-1')).toMatchObject({ id: 'gen-1', status: 'pending' });
    expect(await getGenerationsByIds(['gen-1', 'missing'])).toHaveLength(1);
  });

  it('orders pending and failed generations by creation time', async () => {
    await putGeneration(record('later', 'pending', '2026-01-02T00:00:00.000Z'));
    await putGeneration(record('failed', 'failed', '2026-01-01T00:00:00.000Z'));
    await putGeneration(record('done', 'uploaded', '2026-01-01T00:00:00.000Z'));

    expect((await getPendingGenerations(10)).map((item) => item.id)).toEqual(['failed', 'later']);
    expect(await getPendingCount()).toBe(2);
  });

  it('marks uploads and failures', async () => {
    await putGeneration(record('gen-1', 'pending', '2026-01-01T00:00:00.000Z'));
    await markGenerationFailed('gen-1', 'upload failed');
    expect(await getGeneration('gen-1')).toMatchObject({
      status: 'failed',
      lastError: 'upload failed',
      attempts: 1,
    });

    await markGenerationUploaded('gen-1');
    expect(await getGeneration('gen-1')).toMatchObject({ status: 'uploaded' });
    expect(await getPendingCount()).toBe(0);
  });
});

describe('metadata storage', () => {
  it('stores and clears Notion data source cache entries', async () => {
    await setMeta('notion:dataSources:db', { ids: ['one'], expiresAt: Date.now() + 1000 });
    await setMeta('other', 'keep');
    expect(await getMeta('notion:dataSources:db')).toEqual({ ids: ['one'], expiresAt: expect.any(Number) });

    await clearNotionCache();

    expect(await getMeta('notion:dataSources:db')).toBeUndefined();
    expect(await getMeta('other')).toBe('keep');
  });
});
