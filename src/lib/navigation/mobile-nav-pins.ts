/**
 * Mobile bottom-bar pinned divination — a per-browser display preference.
 *
 * The bottom bar reserves a single slot for one divination method, chosen by
 * long-pressing a tile in the "全部占术" sheet. Storage and fallback rules live
 * in `pin-store.ts`.
 */
import { getNavItemById, type NavItemDef } from '@/lib/navigation/registry';
import { createPinStore } from '@/lib/navigation/pin-store';

export const MOBILE_NAV_PIN_STORAGE_KEY = 'taibu.pref.mobilePinned';
export const DEFAULT_MOBILE_NAV_PINS: readonly string[] = Object.freeze(['liuyao']);

/** Single slot: pinning another method replaces the current one; pinning it again clears the slot. */
export function toggleMobileNavPin(pins: readonly string[], id: string): string[] {
    return pins.includes(id) ? [] : [id];
}

/** Divination methods may take the slot; 日运 / 月运 already have their own entries. */
export function isMobileNavPinnable(item: NavItemDef): boolean {
    return item.category === 'divination' && item.group !== 'fortune';
}

/**
 * Registry item to render in the pinned slot, or `null` when the slot is empty,
 * holds an id that is unknown / not pinnable (stale storage), or is switched off.
 */
export function resolveMobileNavPin(pins: readonly string[], isEnabled: (id: string) => boolean): NavItemDef | null {
    const id = pins[0];
    if (!id) return null;
    const item = getNavItemById(id);
    return item && isMobileNavPinnable(item) && isEnabled(item.id) ? item : null;
}

/** Pinned divination id (at most one) plus a stable toggle; SSR renders the default. */
export const useMobileNavPins = createPinStore({
    storageKey: MOBILE_NAV_PIN_STORAGE_KEY,
    defaults: DEFAULT_MOBILE_NAV_PINS,
    maxPins: 1,
    toggle: toggleMobileNavPin,
});
