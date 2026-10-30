import { describe, expect, it } from 'vitest';
import { getPngPrompt, injectPromptMetadata } from '@/lib/png';

const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function samplePng(): Uint8Array {
  const binary = atob(SAMPLE_PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function pngBlob(): Blob {
  const bytes = samplePng();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'image/png' });
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('PNG prompt metadata', () => {
  it('injects and reads a Latin-1 prompt', async () => {
    const original = pngBlob();
    const result = await injectPromptMetadata(original, 'a cat');
    expect(result.outcome).toBe('written');
    expect(getPngPrompt(await bytesOf(result.blob))).toBe('a cat');
  });

  it('is idempotent', async () => {
    const first = await injectPromptMetadata(pngBlob(), 'a cat');
    const second = await injectPromptMetadata(first.blob, 'a cat');
    expect(second.outcome).toBe('already-present');
    expect(getPngPrompt(await bytesOf(second.blob))).toBe('a cat');
  });

  it('replaces a different existing prompt', async () => {
    const first = await injectPromptMetadata(pngBlob(), 'old prompt');
    const second = await injectPromptMetadata(first.blob, 'new prompt');
    expect(second.outcome).toBe('written');
    expect(getPngPrompt(await bytesOf(second.blob))).toBe('new prompt');
  });

  it('uses iTXt for Unicode prompts', async () => {
    const prompt = 'a cat with a 🐟 and café';
    const result = await injectPromptMetadata(pngBlob(), prompt);
    expect(result.outcome).toBe('written');
    expect(getPngPrompt(await bytesOf(result.blob))).toBe(prompt);
  });

  it('leaves non-PNG images untouched', async () => {
    const blob = new Blob(['not an image'], { type: 'image/jpeg' });
    const result = await injectPromptMetadata(blob, 'prompt');
    expect(result.outcome).toBe('skipped-not-png');
    expect(result.blob).toBe(blob);
  });
});
