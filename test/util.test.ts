import { describe, expect, it } from 'vitest';
import {
  contentTypeForFileName,
  decodeJwtPayload,
  extractEmailFromJwt,
  fileNameForGeneration,
  imageExtFromUrl,
  parseNotionDatabaseId,
  sanitizeFileStem,
  timestampToIso,
} from '@/lib/util';

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
    expect(fileNameForGeneration('file-abc', 'https://example.test/x.webp')).toBe('file-abc.webp');
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
    expect(parseNotionDatabaseId('a1b2c3d4-e5f6-0718-293a-4b5c6d7e8f90')).toBe(id);
  });

  it('accepts database URLs', () => {
    const url = 'https://www.notion.so/workspace/Database-a1b2c3d4e5f60718293a4b5c6d7e8f90?pvs=4';
    expect(parseNotionDatabaseId(url)).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
  });

  it('ignores hex characters in a URL slug', () => {
    const url = 'https://www.notion.so/workspace/deadbeef-a1b2c3d4e5f60718293a4b5c6d7e8f90';
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
    expect(extractEmailFromJwt(decodeJwtPayload(token))).toBe('user@example.com');
  });

  it('reads the namespaced OpenAI auth claim', () => {
    const payload = { 'https://api.openai.com/auth': { email: 'auth@example.com' } };
    const token = `a.${btoa(JSON.stringify(payload))}.c`;
    expect(extractEmailFromJwt(decodeJwtPayload(token))).toBe('auth@example.com');
  });
});
