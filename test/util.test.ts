import { describe, expect, it } from 'vitest';
import type { SyncState } from '@/lib/types';
import {
  computeSyncProgress,
  contentTypeForFileName,
  conversationsToDelete,
  decodeJwtPayload,
  extractEmailFromJwt,
  fileNameForGeneration,
  imageExtFromUrl,
  parseNotionDatabaseId,
  sanitizeFileStem,
  timestampToIso,
} from '@/lib/util';

function baseState(overrides: Partial<SyncState> = {}): SyncState {
  return {
    running: false,
    phase: 'idle',
    runId: null,
    startedAt: null,
    finishedAt: null,
    discovered: 0,
    total: 0,
    current: 0,
    uploaded: 0,
    skipped: 0,
    deleted: 0,
    deletedTotal: 0,
    failed: 0,
    message: '',
    errors: [],
    ...overrides,
  };
}

describe('file naming', () => {
  it('keeps safe ID characters', () => {
    expect(sanitizeFileStem('normal-id_1.2')).toBe('normal-id_1.2');
  });

  it('cannot escape a directory', () => {
    expect(sanitizeFileStem('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFileStem('..')).toBe('_');
    expect(sanitizeFileStem('')).toBe('_');
  });

  it('derives image extensions safely', () => {
    expect(imageExtFromUrl('https://example.test/a.png?sig=1')).toBe('.png');
    expect(imageExtFromUrl('https://example.test/a.JPEG')).toBe('.jpeg');
    expect(imageExtFromUrl('https://example.test/a.svg')).toBe('.png');
    expect(imageExtFromUrl('https://example.test/no-extension')).toBe('.png');
  });

  it('combines stem and extension', () => {
    expect(
      fileNameForGeneration('file-abc', 'https://example.test/x.webp'),
    ).toBe('file-abc.webp');
  });

  it('maps content types', () => {
    expect(contentTypeForFileName('a.png')).toBe('image/png');
    expect(contentTypeForFileName('a.jpeg')).toBe('image/jpeg');
    expect(contentTypeForFileName('a.webp')).toBe('image/webp');
    expect(contentTypeForFileName('a.unknown')).toBe('image/png');
  });
});

describe('Notion database IDs', () => {
  it('accepts raw and hyphenated IDs', () => {
    const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(parseNotionDatabaseId(id)).toBe(id);
    expect(parseNotionDatabaseId('a1b2c3d4-e5f6-0718-293a-4b5c6d7e8f90')).toBe(
      id,
    );
  });

  it('accepts database URLs', () => {
    const url =
      'https://www.notion.so/workspace/Database-a1b2c3d4e5f60718293a4b5c6d7e8f90?pvs=4';
    expect(parseNotionDatabaseId(url)).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
  });

  it('ignores hex characters in a URL slug', () => {
    const url =
      'https://www.notion.so/workspace/deadbeef-a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(parseNotionDatabaseId(url)).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
  });

  it('rejects invalid input', () => {
    expect(parseNotionDatabaseId('')).toBeNull();
    expect(parseNotionDatabaseId('not-a-database')).toBeNull();
  });
});

describe('time and JWT helpers', () => {
  it('normalizes seconds and milliseconds', () => {
    expect(timestampToIso(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z');
    expect(timestampToIso(1_700_000_000_000)).toBe('2023-11-14T22:13:20.000Z');
  });

  it('decodes an email from a JWT payload', () => {
    const payload = { email: 'user@example.com', exp: 123 };
    const token = `header.${btoa(JSON.stringify(payload)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
    expect(decodeJwtPayload(token)).toMatchObject(payload);
    expect(extractEmailFromJwt(decodeJwtPayload(token))).toBe(
      'user@example.com',
    );
  });

  it('reads the namespaced OpenAI auth claim', () => {
    const payload = {
      'https://api.openai.com/auth': { email: 'auth@example.com' },
    };
    const token = `a.${btoa(JSON.stringify(payload))}.c`;
    expect(extractEmailFromJwt(decodeJwtPayload(token))).toBe(
      'auth@example.com',
    );
  });
});

describe('computeSyncProgress', () => {
  it('reports 0% when idle with nothing to process', () => {
    expect(computeSyncProgress(baseState())).toEqual({
      deleting: false,
      percent: 0,
    });
  });

  it('shows processing progress while running', () => {
    const sync = baseState({
      running: true,
      phase: 'processing',
      total: 10,
      current: 5,
    });
    expect(computeSyncProgress(sync)).toEqual({
      deleting: false,
      percent: 50,
    });
  });

  it('does not report deletion while records are still processing', () => {
    const sync = baseState({
      running: true,
      phase: 'processing',
      total: 10,
      current: 5,
      deletedTotal: 5,
      deleted: 0,
    });
    expect(computeSyncProgress(sync)).toEqual({
      deleting: false,
      percent: 33,
    });
  });

  it('stays monotonic across processing and deletion', () => {
    // All records skip (current reaches total) before deletion even starts:
    // the bar must NOT hit 100% yet.
    const beforeDelete = baseState({
      running: true,
      phase: 'processing',
      total: 10,
      current: 10,
      deletedTotal: 5,
      deleted: 0,
    });
    expect(computeSyncProgress(beforeDelete)).toEqual({
      deleting: true,
      percent: 67,
    });

    const duringDelete = {
      ...beforeDelete,
      deleted: 2,
    };
    expect(computeSyncProgress(duringDelete)).toEqual({
      deleting: true,
      percent: 80,
    });
  });

  it('never reports deletion when not running', () => {
    const sync = baseState({
      running: false,
      total: 10,
      current: 10,
      deletedTotal: 5,
      deleted: 1,
    });
    const progress = computeSyncProgress(sync);
    expect(progress.deleting).toBe(false);
    expect(progress.percent).toBe(73);
  });

  it('leaves deletion once all conversations are deleted', () => {
    const sync = baseState({
      running: true,
      total: 10,
      current: 10,
      deletedTotal: 5,
      deleted: 5,
    });
    const progress = computeSyncProgress(sync);
    expect(progress.deleting).toBe(false);
    expect(progress.percent).toBe(100);
  });
});

describe('conversationsToDelete', () => {
  const grouped = new Map<string, unknown[]>([
    ['a', [1, 2, 3]],
    ['b', [1, 2]],
    ['c', [1]],
  ]);

  it('deletes nothing when delete is disabled', () => {
    expect(
      conversationsToDelete(
        false,
        grouped,
        new Map([
          ['a', 3],
          ['b', 2],
          ['c', 1],
        ]),
      ),
    ).toEqual([]);
  });

  it('deletes every full-ok conversation when enabled', () => {
    expect(
      conversationsToDelete(
        true,
        grouped,
        new Map([
          ['a', 3],
          ['b', 2],
          ['c', 1],
        ]),
      ),
    ).toEqual(['a', 'b', 'c']);
  });

  it('deletes only conversations with all records ok', () => {
    expect(
      conversationsToDelete(
        true,
        grouped,
        new Map([
          ['a', 2],
          ['b', 2],
          ['c', 0],
        ]),
      ),
    ).toEqual(['b']);
  });

  it('deletes nothing when no conversation is fully ok', () => {
    expect(
      conversationsToDelete(
        true,
        grouped,
        new Map([
          ['a', 1],
          ['b', 0],
          ['c', 0],
        ]),
      ),
    ).toEqual([]);
  });

  it('ignores conversations missing from the ok-count map', () => {
    expect(conversationsToDelete(true, grouped, new Map())).toEqual([]);
  });
});
