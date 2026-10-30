import * as CRC32 from 'crc-32';

export type PngOutcome = 'written' | 'already-present' | 'skipped-not-png';

export interface PngResult {
  blob: Blob;
  outcome: PngOutcome;
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface PngChunk {
  type: string;
  data: Uint8Array;
  raw: Uint8Array;
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) {
    return false;
  }
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function readChunks(bytes: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    const length = view.getUint32(0);
    const end = offset + 12 + length;
    if (end > bytes.length) {
      throw new Error('Invalid PNG: truncated chunk');
    }
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    chunks.push({
      type,
      data: bytes.subarray(offset + 8, offset + 8 + length),
      raw: bytes.subarray(offset, end),
    });
    offset = end;
    if (type === 'IEND') {
      break;
    }
  }
  if (!chunks.some((chunk) => chunk.type === 'IEND')) {
    throw new Error('Invalid PNG: no IEND chunk');
  }
  return chunks;
}

function chunkKeyword(chunk: PngChunk): string | undefined {
  if (chunk.type !== 'tEXt' && chunk.type !== 'iTXt') {
    return undefined;
  }
  const end = chunk.data.indexOf(0);
  if (end === -1) {
    return undefined;
  }
  return String.fromCharCode(...chunk.data.subarray(0, end));
}

function chunkText(chunk: PngChunk): string | undefined {
  const keywordEnd = chunk.data.indexOf(0);
  if (keywordEnd === -1) {
    return undefined;
  }
  if (chunk.type === 'tEXt') {
    return String.fromCharCode(...chunk.data.subarray(keywordEnd + 1));
  }
  if (chunk.type !== 'iTXt') {
    return undefined;
  }
  let offset = keywordEnd + 1;
  if (offset + 2 > chunk.data.length) {
    return undefined;
  }
  const compressionFlag = chunk.data[offset];
  const compressionMethod = chunk.data[offset + 1];
  if (compressionFlag !== 0 || compressionMethod !== 0) {
    return undefined;
  }
  offset += 2;
  const languageEnd = chunk.data.indexOf(0, offset);
  if (languageEnd === -1) {
    return undefined;
  }
  offset = languageEnd + 1;
  const translatedEnd = chunk.data.indexOf(0, offset);
  if (translatedEnd === -1) {
    return undefined;
  }
  offset = translatedEnd + 1;
  return new TextDecoder().decode(chunk.data.subarray(offset));
}

function crc32(bytes: Uint8Array): number {
  return CRC32.buf(bytes) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function latin1Bytes(prompt: string): Uint8Array {
  const bytes = new Uint8Array(prompt.length);
  for (let index = 0; index < prompt.length; index += 1) {
    bytes[index] = prompt.charCodeAt(index);
  }
  return bytes;
}

function promptChunk(prompt: string): Uint8Array {
  const keyword = new TextEncoder().encode('Prompt');
  const latin1Safe =
    !prompt.includes('\0') &&
    [...prompt].every((character) => (character.codePointAt(0) ?? 0) <= 0xff);

  if (latin1Safe) {
    const data = new Uint8Array(keyword.length + 1 + prompt.length);
    data.set(keyword, 0);
    data[keyword.length] = 0;
    data.set(latin1Bytes(prompt), keyword.length + 1);
    return makeChunk('tEXt', data);
  }

  const text = new TextEncoder().encode(prompt);
  const data = new Uint8Array(keyword.length + 5 + text.length);
  let offset = 0;
  data.set(keyword, offset);
  offset += keyword.length;
  data[offset++] = 0; // keyword terminator
  data[offset++] = 0; // compression flag
  data[offset++] = 0; // compression method
  data[offset++] = 0; // language tag terminator
  data[offset++] = 0; // translated keyword terminator
  data.set(text, offset);
  return makeChunk('iTXt', data);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function getPngPrompt(bytes: Uint8Array): string | undefined {
  if (!isPng(bytes)) {
    return undefined;
  }
  for (const chunk of readChunks(bytes)) {
    if (chunkKeyword(chunk) === 'Prompt') {
      return chunkText(chunk);
    }
  }
  return undefined;
}

/**
 * Inject the prompt into a PNG tEXt/iTXt chunk, matching c2n's behavior.
 *
 * The chunk is inserted before IEND, existing Prompt chunks are replaced, and
 * the operation is idempotent.
 */
export async function injectPromptMetadata(blob: Blob, prompt: string): Promise<PngResult> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isPng(bytes)) {
    return { blob, outcome: 'skipped-not-png' };
  }

  const chunks = readChunks(bytes);
  const existing = chunks.filter((chunk) => chunkKeyword(chunk) === 'Prompt');
  if (existing.length === 1 && chunkText(existing[0]!) === prompt) {
    return { blob, outcome: 'already-present' };
  }

  const output: Uint8Array[] = [PNG_SIGNATURE];
  const newChunk = promptChunk(prompt);
  for (const chunk of chunks) {
    if (chunkKeyword(chunk) === 'Prompt') {
      continue;
    }
    if (chunk.type === 'IEND') {
      output.push(newChunk);
    }
    output.push(chunk.raw);
  }

  const merged = concat(output);
  const buffer = merged.buffer.slice(
    merged.byteOffset,
    merged.byteOffset + merged.byteLength,
  ) as ArrayBuffer;

  return {
    blob: new Blob([buffer], { type: blob.type || 'image/png' }),
    outcome: 'written',
  };
}
