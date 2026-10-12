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

/** True at the `lg` breakpoint, where the desktop sidebars are shown; false on the server. */
export function useIsDesktopLayout() {
    return useSyncExternalStore(
        subscribe,
        () => (typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : false),
        () => false,
    );
}
