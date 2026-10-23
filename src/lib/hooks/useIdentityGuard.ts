'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useSessionSafe } from '@/lib/hooks/session-context';

/** A response stays obsolete even if the user switches A → B → A. */
export function useIdentityGuard(identity: string | null) {
    const current = useRef({ identity });
    if (current.current.identity !== identity) current.current = { identity };
    return useCallback(() => {
        const origin = current.current;
        return () => current.current === origin;
    }, []);
}

/** Remount account-owned result state and fence callbacks from earlier identities. */
export function useResultIdentity() {
    const { user, loading } = useSessionSafe();
    const key = `${loading}:${user?.id ?? ''}`;
    const capture = useIdentityGuard(key);
    const isCurrent = useMemo(() => capture(), [capture, key]);
    return { key, isCurrent };
}
