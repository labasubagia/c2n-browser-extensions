import { describe, expect, it } from 'vitest';
import { buildPagePayload } from '@/lib/notion';

describe('Notion page payload', () => {
  it('uses hardcoded Name and Image properties', () => {
    const payload = buildPagePayload(
      'db-id',
      'gen-1.png',
      'a red fox',
      'user@example.com',
    );
    expect(payload.parent).toEqual({ database_id: 'db-id' });
    expect(payload.properties).toEqual({
      Name: { title: [{ text: { content: 'gen-1.png' } }] },
      Image: { files: [{ type: 'file_upload', file_upload: { id: '' } }] },
    });
  });

  it('includes the prompt and normalized line endings in markdown', () => {
    const payload = buildPagePayload(
      'db-id',
      'gen-1.png',
      'line one\r\nline two',
      undefined,
    );
    expect(payload.markdown).toContain('**Prompt:**');
    expect(payload.markdown).toContain('line one\nline two');
    expect(payload.markdown).not.toContain('Email:');
  });

  it('includes the email when available', () => {
    const payload = buildPagePayload(
      'db-id',
      'gen-1.png',
      'prompt',
      'user@example.com',
    );
    expect(payload.markdown).toContain('**Email:** user@example.com');
  });
});
