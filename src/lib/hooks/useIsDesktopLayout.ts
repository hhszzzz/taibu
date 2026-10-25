'use client';
// Reads a media query, so it only runs in the browser.
import { useSyncExternalStore } from 'react';

const DESKTOP_QUERY = '(min-width: 1024px)';

function subscribe(onStoreChange: () => void) {
    if (typeof window === 'undefined') return () => {};
    const mediaQuery = window.matchMedia(DESKTOP_QUERY);
    mediaQuery.addEventListener('change', onStoreChange);
    return () => mediaQuery.removeEventListener('change', onStoreChange);
}

/** True at the `lg` breakpoint, where the desktop sidebars are shown and side panels dock; false on the server. */
export function isDesktopLayout() {
    return typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches;
}

/** {@link isDesktopLayout}, following the viewport. */
export function useIsDesktopLayout() {
    return useSyncExternalStore(subscribe, isDesktopLayout, () => false);
}
