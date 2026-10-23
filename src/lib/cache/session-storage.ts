export function readSessionJSON<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeSessionJSON<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

export function updateSessionJSON<T>(key: string, updater: (prev: T | null) => T) {
  const prev = readSessionJSON<T>(key);
  const next = updater(prev);
  writeSessionJSON<T>(key, next);
}

type ResultOwnership = { recordOwnerId?: string | null; chartId?: string | null; readingId?: string | null; divinationId?: string | null; conversationId?: string | null };

/** Keep the calculated input, but never carry another account's saved IDs. */
export function scopeResultSession<T extends ResultOwnership>(value: T, userId: string | null): T {
  if (value.recordOwnerId === userId) return value;
  return { ...value, recordOwnerId: userId, chartId: undefined, readingId: undefined, divinationId: undefined, conversationId: undefined };
}
