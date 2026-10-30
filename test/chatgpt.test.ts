import { describe, expect, it } from 'vitest';
import {
  getConversationMappingKeyByAssetPointer,
  getPromptFromImageNodeInConversation,
  normalizeImageGenItem,
  parseSseEvents,
} from '@/lib/chatgpt';

const conversation = {
  mapping: {
    image: {
      id: 'image',
      parent: 'user',
      message: {
        author: { role: 'assistant' },
        content: { parts: [{ asset_pointer: 'file-service://image-1' }] },
      },
    },
    user: {
      id: 'user',
      parent: 'system',
      message: {
        author: { role: 'user' },
        content: { parts: ['draw a red fox in a forest'] },
      },
    },
    system: {
      id: 'system',
      parent: null,
      message: { author: { role: 'system' }, content: { parts: [] } },
    },
  },
};

describe('ChatGPT conversation parsing', () => {
  it('walks parent links to the user prompt', () => {
    expect(
      getPromptFromImageNodeInConversation(
        conversation,
        'image',
        'file-service://image-1',
      ),
    ).toBe('draw a red fox in a forest');
  });

  it('finds the node by asset pointer when the message ID is absent', () => {
    expect(
      getConversationMappingKeyByAssetPointer(
        conversation,
        'file-service://image-1',
      ),
    ).toBe('image');
    expect(
      getPromptFromImageNodeInConversation(
        conversation,
        'missing',
        'file-service://image-1',
      ),
    ).toBe('draw a red fox in a forest');
  });

  it('returns undefined for unknown images', () => {
    expect(
      getPromptFromImageNodeInConversation(conversation, 'missing', 'unknown'),
    ).toBeUndefined();
  });
});

describe('recent image generation normalization', () => {
  it('accepts a complete item', () => {
    expect(
      normalizeImageGenItem({
        id: 'gen-1',
        message_id: 'msg-1',
        asset_pointer: 'file-service://image-1',
        conversation_id: 'conv-1',
        url: 'https://example.test/image.png',
        created_at: 1_700_000_000,
      }),
    ).toEqual({
      id: 'gen-1',
      messageId: 'msg-1',
      assetPointer: 'file-service://image-1',
      conversationId: 'conv-1',
      url: 'https://example.test/image.png',
      createdAt: 1_700_000_000,
    });
  });

  it('rejects items without required fields', () => {
    expect(
      normalizeImageGenItem({ id: 'gen-1', url: 'https://example.test/a.png' }),
    ).toBeNull();
    expect(
      normalizeImageGenItem({ id: 'gen-1', conversation_id: 'c', url: 'u' }),
    ).toBeNull();
  });
});

describe('SSE parsing', () => {
  it('collects JSON data events and ignores sentinels', () => {
    const body = [
      'event: message',
      'data: {"type":"start"}',
      '',
      'data: {"type":"delta",',
      'data: "value":1}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    expect(parseSseEvents(body)).toEqual([
      { type: 'start' },
      { type: 'delta', value: 1 },
    ]);
  });

  it('falls back to line-delimited JSON', () => {
    expect(parseSseEvents('{"ok":true}\nnot json')).toEqual([{ ok: true }]);
  });
});
