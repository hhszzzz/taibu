'use client';

import { useCallback, useLayoutEffect, useMemo } from 'react';
import { useSessionSafe } from '@/lib/hooks/session-context';

type IdentityToken = { identity: string | null };

// Latest committed token per hook instance, read only when a capture is checked.
const latestTokens = new WeakMap<object, IdentityToken>();

/** A response stays obsolete even if the user switches A → B → A. */
export function useIdentityGuard(identity: string | null) {
    const instance = useMemo<object>(() => ({}), []);
    const token = useMemo<IdentityToken>(() => ({ identity }), [identity]);
    useLayoutEffect(() => { latestTokens.set(instance, token); }, [instance, token]);
    return useCallback(() => {
        const origin = token;
        return () => latestTokens.get(instance) === origin;
    }, [instance, token]);
}

/** Remount account-owned result state and fence callbacks from earlier identities. */
export function useResultIdentity() {
    const { user, loading } = useSessionSafe();
    const key = `${loading}:${user?.id ?? ''}`;
    const capture = useIdentityGuard(key);
    const isCurrent = useMemo(() => capture(), [capture]);
    return { key, isCurrent };
}
