/**
 * Sidebar pinned divination items — a per-browser display preference.
 *
 * The desktop sidebar only lists pinned methods; everything else lives in the
 * "全部占术" panel. Storage and fallback rules live in `pin-store.ts`.
 */
import { createPinStore, normalizePinList } from '@/lib/navigation/pin-store';

export const SIDEBAR_PINS_STORAGE_KEY = 'taibu.pref.sidebarPinned';
export const DEFAULT_SIDEBAR_PINS: readonly string[] = Object.freeze(['bazi', 'ziwei', 'tarot', 'liuyao', 'qimen']);

const MAX_PINS = 32;

/**
 * Parse a stored pin list. Returns `null` for anything that is not an array of
 * ids so callers can fall back to defaults; drops malformed entries and duplicates.
 */
export function normalizeSidebarPins(value: unknown): string[] | null {
    return normalizePinList(value, MAX_PINS);
}

/** Toggle `id` in `pins`, appending new pins at the end. */
export function toggleSidebarPin(pins: readonly string[], id: string): string[] {
    return pins.includes(id) ? pins.filter(pin => pin !== id) : [...pins, id];
}

/** Pinned divination ids plus a stable toggle; SSR renders the defaults. */
export const useSidebarPins = createPinStore({
    storageKey: SIDEBAR_PINS_STORAGE_KEY,
    defaults: DEFAULT_SIDEBAR_PINS,
    maxPins: MAX_PINS,
    toggle: toggleSidebarPin,
});
