/**
 * localStorage-backed pin lists shared by the desktop sidebar and the mobile
 * bottom bar.
 *
 * Pins are a per-browser display preference, not account data, so they live in
 * localStorage (same tier as the theme preference) and fall back to defaults
 * whenever storage is unavailable or holds something unexpected.
 */
import { useCallback, useSyncExternalStore } from 'react';

const PIN_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * Parse a stored pin list. Returns `null` for anything that is not an array of
 * ids so callers can fall back to defaults; drops malformed entries and duplicates
 * and keeps at most `maxPins` entries.
 */
export function normalizePinList(value: unknown, maxPins: number): string[] | null {
    if (!Array.isArray(value)) return null;
    const pins: string[] = [];
    for (const entry of value) {
        if (pins.length >= maxPins) break;
        if (typeof entry !== 'string' || !PIN_ID_PATTERN.test(entry) || pins.includes(entry)) continue;
        pins.push(entry);
    }
    return pins;
}

interface PinStoreOptions {
    storageKey: string;
    defaults: readonly string[];
    maxPins: number;
    /** Next pin list after the user toggles `id`; must not mutate `pins`. */
    toggle: (pins: readonly string[], id: string) => string[];
}

/** Create a pin store and the hook that reads it; SSR renders the defaults. */
export function createPinStore({ storageKey, defaults, maxPins, toggle }: PinStoreOptions) {
    const listeners = new Set<() => void>();
    let cachedRaw: string | null | undefined;
    let cachedPins: readonly string[] = defaults;
    /** Set only when storage rejects a write, so the choice survives this page view. */
    let memoryPins: readonly string[] | null = null;

    function readRaw(): string | null {
        try {
            return window.localStorage.getItem(storageKey);
        } catch {
            return null;
        }
    }

    function getSnapshot(): readonly string[] {
        if (memoryPins) return memoryPins;
        const raw = readRaw();
        if (raw === cachedRaw) return cachedPins;
        cachedRaw = raw;
        let parsed: unknown = null;
        if (raw !== null) {
            try { parsed = JSON.parse(raw); } catch { parsed = null; }
        }
        cachedPins = normalizePinList(parsed, maxPins) ?? defaults;
        return cachedPins;
    }

    function getServerSnapshot(): readonly string[] {
        return defaults;
    }

    function subscribe(listener: () => void) {
        listeners.add(listener);
        const onStorage = (event: StorageEvent) => {
            if (event.key === null || event.key === storageKey) listener();
        };
        window.addEventListener('storage', onStorage);
        return () => {
            listeners.delete(listener);
            window.removeEventListener('storage', onStorage);
        };
    }

    function writePins(pins: readonly string[]) {
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(pins));
            memoryPins = null;
        } catch {
            // Private mode or quota: keep the in-memory value for this page view.
            memoryPins = pins;
        }
        listeners.forEach(listener => listener());
    }

    return function usePins() {
        const pins = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
        const togglePin = useCallback((id: string) => {
            writePins(toggle(getSnapshot(), id));
        }, []);
        return { pins, togglePin };
    };
}
