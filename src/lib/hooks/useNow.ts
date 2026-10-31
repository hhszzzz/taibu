'use client';

import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let current = Date.now();

function tick() {
    current = Date.now();
    for (const listener of listeners) listener();
}

/** A shared clock for rendering time-dependent state without reading Date.now() during render. */
export function useNow(intervalMs = 60_000): number {
    return useSyncExternalStore(
        (onChange) => {
            listeners.add(onChange);
            if (listeners.size === 1) {
                current = Date.now();
                timer = setInterval(tick, intervalMs);
            }
            return () => {
                listeners.delete(onChange);
                if (!listeners.size && timer) {
                    clearInterval(timer);
                    timer = null;
                }
            };
        },
        () => current,
        () => current,
    );
}
