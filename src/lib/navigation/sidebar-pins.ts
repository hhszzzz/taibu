/**
 * Sidebar pinned divination items — a per-browser display preference.
 *
 * The desktop sidebar lists the methods the user pinned; everything else lives
 * in the "全部占术" panel. Only 八字 / 紫微 / 塔罗 / 六爻 / 日运 start pinned, and
 * every entry can be pinned or unpinned from that panel. Storage and fallback
 * rules live in `pin-store.ts`.
 */
import { getSidebarNavItems } from '@/lib/navigation/registry';
import { createPinStore, normalizePinList } from '@/lib/navigation/pin-store';

/** Pin list key; shared by every reader of the sidebar preference. */
export const SIDEBAR_PINS_STORAGE_KEY = 'taibu.pref.sidebarPinned';
export const DEFAULT_SIDEBAR_PINS: readonly string[] = Object.freeze(['bazi', 'ziwei', 'tarot', 'liuyao', 'daily']);

/**
 * Display order for every sidebar divination entry. It follows the registry
 * declaration order, so pinning / unpinning only decides whether an item shows
 * up — never where the remaining items sit relative to each other.
 */
export const SIDEBAR_DIVINATION_ORDER: readonly string[] = Object.freeze(
    getSidebarNavItems().map(item => item.id),
);

const MAX_PINS = 32;

/**
 * Parse a stored pin list. Returns `null` for anything that is not an array of
 * ids so callers can fall back to defaults; drops malformed entries and duplicates.
 */
export function normalizeSidebarPins(value: unknown): string[] | null {
    return normalizePinList(value, MAX_PINS);
}

/** Toggle `id` in `pins`, appending new pins at the end; every divination entry behaves the same. */
export function toggleSidebarPin(pins: readonly string[], id: string): string[] {
    return pins.includes(id) ? pins.filter(pin => pin !== id) : [...pins, id];
}

/**
 * Pins in the fixed display order. Unknown or stale ids (and duplicates left by
 * old storage) are dropped.
 */
export function resolveSidebarPinnedIds(pins: readonly string[]): string[] {
    const visible = new Set<string>(pins);
    return SIDEBAR_DIVINATION_ORDER.filter(id => visible.has(id));
}

/** Pinned divination ids plus a stable toggle; SSR renders the defaults. */
export const useSidebarPins = createPinStore({
    storageKey: SIDEBAR_PINS_STORAGE_KEY,
    defaults: DEFAULT_SIDEBAR_PINS,
    maxPins: MAX_PINS,
    toggle: toggleSidebarPin,
});
