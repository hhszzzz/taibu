/**
 * Keys of own-model connections kept on this device, per account: this browser calls the provider with them, or hands
 * one to an Agent task that needs it. Logging out removes them; a key stored on the site is never kept here.
 */
'use client';

import { useMemo, useSyncExternalStore } from 'react';

const PREFIX = 'taibu:byok-keys:';
const CHANGED = 'taibu:byok-keys:changed';

function parse(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1]));
  } catch {
    return {};
  }
}

function readRaw(userId: string): string | null {
  try {
    return window.localStorage.getItem(`${PREFIX}${userId}`);
  } catch {
    return null;
  }
}

/** Keys by connection ID. */
export function readDeviceKeys(userId: string | null | undefined): Record<string, string> {
  return userId && typeof window !== 'undefined' ? parse(readRaw(userId)) : {};
}

/** Keeps or forgets a connection's key on this device; false when the browser refused to store it. */
export function setDeviceKey(userId: string, connectionId: string, key: string | null): boolean {
  const keys = readDeviceKeys(userId);
  if (key) keys[connectionId] = key;
  else delete keys[connectionId];
  let stored = true;
  try {
    if (Object.keys(keys).length) window.localStorage.setItem(`${PREFIX}${userId}`, JSON.stringify(keys));
    else window.localStorage.removeItem(`${PREFIX}${userId}`);
  } catch {
    stored = false;
  }
  window.dispatchEvent(new Event(CHANGED));
  return stored;
}

/** Logout: every account's keys leave this device. */
export function clearDeviceKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const name of Object.keys(window.localStorage)) {
      if (name.startsWith(PREFIX)) window.localStorage.removeItem(name);
    }
  } catch {
    // Storage that cannot be read holds no keys either.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** This device's keys for the account, following edits in this and other tabs. */
export function useDeviceKeys(userId: string | null | undefined): Record<string, string> {
  // The raw string is the snapshot: it stays the same object while nothing changed.
  const raw = useSyncExternalStore(subscribe, () => (userId ? readRaw(userId) : null), () => null);
  return useMemo(() => parse(raw), [raw]);
}
