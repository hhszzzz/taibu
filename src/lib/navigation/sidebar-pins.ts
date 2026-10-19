/**
 * Sidebar pinned divination items — a per-browser display preference.
 *
 * The desktop sidebar always lists the built-in fortune entries (日运 / 月运)
 * plus the methods the user pinned; everything else lives in the "全部占术"
 * panel. Storage and fallback rules live in `pin-store.ts`.
 */
import { getSidebarNavItems } from '@/lib/navigation/registry';
import { createPinStore, normalizePinList } from '@/lib/navigation/pin-store';

export const SIDEBAR_PINS_STORAGE_KEY = 'taibu.pref.sidebarPinned';
export const DEFAULT_SIDEBAR_PINS: readonly string[] = Object.freeze(['bazi', 'ziwei', 'tarot', 'liuyao', 'qimen']);

/**
 * Entries the sidebar always shows. They are not user pins: no toggle can add
 * or remove them, and they stay visible when the stored pin list is empty.
 */
export const BUILT_IN_SIDEBAR_PINS: readonly string[] = Object.freeze(['daily', 'monthly']);

/**
 * Display order for every sidebar divination entry. It follows the registry
 * declaration order, so pinning / unpinning only decides whether an item shows
 * up — never where the remaining items sit relative to each other.
 */
export const SIDEBAR_DIVINATION_ORDER: readonly string[] = Object.freeze(
    getSidebarNavItems().map(item => item.id),
);

const BUILT_IN_PIN_SET: ReadonlySet<string> = new Set(BUILT_IN_SIDEBAR_PINS);

const MAX_PINS = 32;

/**
 * Parse a stored pin list. Returns `null` for anything that is not an array of
 * ids so callers can fall back to defaults; drops malformed entries and duplicates.
 */
export function normalizeSidebarPins(value: unknown): string[] | null {
    return normalizePinList(value, MAX_PINS);
}

/** Toggle `id` in `pins`, appending new pins at the end; built-in entries never move. */
export function toggleSidebarPin(pins: readonly string[], id: string): string[] {
    if (BUILT_IN_PIN_SET.has(id)) return [...pins];
    return pins.includes(id) ? pins.filter(pin => pin !== id) : [...pins, id];
}

/**
 * User pins + built-in entries in the fixed display order. Unknown or stale ids
 * (and duplicates left by old storage) are dropped.
 */
export function resolveSidebarPinnedIds(pins: readonly string[]): string[] {
    const visible = new Set<string>(pins);
    for (const id of BUILT_IN_SIDEBAR_PINS) visible.add(id);
    return SIDEBAR_DIVINATION_ORDER.filter(id => visible.has(id));
}

/** Pinned divination ids plus a stable toggle; SSR renders the defaults. */
export const useSidebarPins = createPinStore({
    storageKey: SIDEBAR_PINS_STORAGE_KEY,
    defaults: DEFAULT_SIDEBAR_PINS,
    maxPins: MAX_PINS,
    toggle: toggleSidebarPin,
});
