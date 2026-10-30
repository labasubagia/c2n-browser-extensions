const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
]);

export function sanitizeFileStem(id: string): string {
  let stem = '';
  for (const character of id) {
    if (
      (character >= 'a' && character <= 'z') ||
      (character >= 'A' && character <= 'Z') ||
      (character >= '0' && character <= '9') ||
      character === '-' ||
      character === '_' ||
      character === '.'
    ) {
      stem += character;
    } else {
      stem += '_';
    }
  }
  if (!stem || stem === '.' || stem === '..') {
    return '_';
  }
  return stem;
}

export function imageExtFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const path = url.pathname;
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    const dot = lastSegment.lastIndexOf('.');
    if (dot === -1) {
      return '.png';
    }
    const extension = lastSegment.slice(dot).toLowerCase();
    return IMAGE_EXTENSIONS.has(extension) ? extension : '.png';
  } catch {
    const path = rawUrl.split(/[?#]/)[0] ?? rawUrl;
    const dot = path.lastIndexOf('.');
    if (dot === -1) {
      return '.png';
    }
    const extension = path.slice(dot).toLowerCase();
    return IMAGE_EXTENSIONS.has(extension) ? extension : '.png';
  }
}

export function fileNameForGeneration(id: string, url: string): string {
  return `${sanitizeFileStem(id)}${imageExtFromUrl(url)}`;
}

export function timestampToIso(value: number): string {
  if (!Number.isFinite(value)) {
    return new Date().toISOString();
  }
  const milliseconds = value > 10_000_000_000 ? value : value * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

/**
 * Accept either a raw 32-character Notion database ID, a hyphenated UUID, or
 * a full Notion URL.
 */
export function parseNotionDatabaseId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (/^[0-9a-f]{32}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const uuid = trimmed.match(
    /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i,
  );
  if (uuid) {
    return uuid.slice(1).join('').toLowerCase();
  }

  const cleaned = trimmed.split(/[?#]/)[0] ?? trimmed;
  const tail = cleaned.replace(/\/+$/, '').split('/').pop() ?? '';
  const compactId = tail.match(/([0-9a-f]{32})$/i)?.[1];
  if (compactId) {
    return compactId.toLowerCase();
  }
  const hyphenated = tail.match(
    /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i,
  );
  if (hyphenated) {
    return hyphenated.slice(1).join('').toLowerCase();
  }
  return null;
}

export function contentTypeForFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  if (lower.endsWith('.avif')) {
    return 'image/avif';
  }
  return 'image/png';
}

export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const payloadPart = parts[1];
  if (!payloadPart) {
    return null;
  }
  try {
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '=',
    );
    const json = atob(padded);
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function extractEmailFromJwt(
  payload: Record<string, unknown> | null,
): string | undefined {
  if (!payload) {
    return undefined;
  }
  const direct = payload.email;
  if (typeof direct === 'string' && direct.includes('@')) {
    return direct;
  }
  const auth = payload['https://api.openai.com/auth'];
  if (auth && typeof auth === 'object') {
    const authEmail = (auth as Record<string, unknown>).email;
    if (typeof authEmail === 'string' && authEmail.includes('@')) {
      return authEmail;
    }
  }
  const user = payload.user;
  if (user && typeof user === 'object') {
    const userEmail = (user as Record<string, unknown>).email;
    if (typeof userEmail === 'string' && userEmail.includes('@')) {
      return userEmail;
    }
  }
  return undefined;
}

export function extractEmailFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.email === 'string' && record.email.includes('@')) {
    return record.email;
  }
  for (const nested of ['user', 'account', 'profile']) {
    const child = record[nested];
    if (child && typeof child === 'object') {
      const email = extractEmailFromUnknown(child);
      if (email) {
        return email;
      }
    }
  }
  return undefined;
}

export function safeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = '';
    url.hash = '';
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return rawUrl.split(/[?#]/)[0] ?? rawUrl;
  }
}

export function truncate(value: string, limit = 500): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}
