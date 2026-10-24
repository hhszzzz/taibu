'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { loadAdminClientAccessState } from '@/lib/admin/client';
import { subscribeToAuth } from '@/lib/auth';

export function useAdminJsonCopy(jsonPayload: unknown) {
    const { showToast } = useToast();
    const [isAdmin, setIsAdmin] = useState(false);
    const [jsonCopied, setJsonCopied] = useState(false);
    const resetTimerRef = useRef<number | null>(null);

    useEffect(() => {
        let cancelled = false;

        const loadAccess = async () => {
            try {
                const access = await loadAdminClientAccessState();
                if (!cancelled) {
                    setIsAdmin(access.isAdmin);
                }
            } catch (error) {
                if (!cancelled) {
                    setIsAdmin(false);
                    showToast('error', error instanceof Error ? error.message : '加载管理员权限失败');
                }
            }
        };

        void loadAccess();
        const unsubscribe = subscribeToAuth(() => {
            void loadAccess();
        });

        return () => {
            cancelled = true;
            unsubscribe();
            if (resetTimerRef.current !== null) {
                window.clearTimeout(resetTimerRef.current);
            }
        };
    }, [showToast]);

    const copyJson = useCallback(async () => {
        if (!isAdmin || jsonPayload == null) return;

        try {
            await navigator.clipboard.writeText(JSON.stringify(jsonPayload, null, 2));
            setJsonCopied(true);
            if (resetTimerRef.current !== null) {
                window.clearTimeout(resetTimerRef.current);
            }
            resetTimerRef.current = window.setTimeout(() => setJsonCopied(false), 2000);
            showToast('success', 'JSON 已复制到剪贴板');
        } catch {
            showToast('error', '复制 JSON 失败，请手动复制');
        }
    }, [isAdmin, jsonPayload, showToast]);

    return {
        isAdmin,
        jsonCopied,
        copyJson,
    };
}
