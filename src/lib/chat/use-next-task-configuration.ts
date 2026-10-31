'use client';
import { useEffect, useRef, useState } from 'react';
import { requestBrowserJson } from '@/lib/browser-api';
import { freshTaskConfiguration, parseNextTaskConfiguration, type NextTaskConfiguration as Configuration } from './model-settings';
export function useNextTaskConfiguration(userId: string | null, conversationId: string | null, configuration: Configuration, apply: (value: Configuration) => void) {
    const key = `${userId ?? 'visitor'}:${conversationId ?? 'new'}`;
    const [loaded, setLoaded] = useState<string | null>(null);
    const latest = useRef({ key, userId, conversationId, configuration, apply, loaded });
    useEffect(() => { latest.current = { key, userId, conversationId, configuration, apply, loaded }; });
    const saved = useRef(new Map<string, string>());
    const saving = useRef(false);
    const value = JSON.stringify(configuration);
    useEffect(() => {
        if (!userId) return;
        const controller = new AbortController();
        const initial = JSON.stringify(latest.current.configuration);
        const load = async () => {
            let accountDefault: Configuration | null = null;
            if (!conversationId) {
                try {
                    const raw = JSON.parse(localStorage.getItem(`taibu.next-task:${userId}`) ?? 'null');
                    if (raw) accountDefault = parseNextTaskConfiguration(raw);
                } catch { /* optional account preference cache */ }
            }
            // 新对话从不协作开始：账户默认只带模型、推理与联网，协作成员由用户在本对话里勾选。
            const fresh = conversationId ? null : freshTaskConfiguration(accountDefault ?? latest.current.configuration);
            const result = conversationId ? await requestBrowserJson<{ configuration: Configuration | null }>(`/api/conversations/${conversationId}/configuration`, { signal: controller.signal }) : { data: { configuration: fresh }, error: null };
            if (controller.signal.aborted) return;
            if (result?.error) return; // Never overwrite unread persisted settings after a failed load.
            if (result?.data?.configuration && initial === JSON.stringify(latest.current.configuration)) {
                const configuration = parseNextTaskConfiguration(result.data.configuration);
                saved.current.set(key, JSON.stringify(configuration));
                latest.current.apply(configuration);
            } else saved.current.delete(key);
            setLoaded(key);
        };
        void load().catch(() => {});
        return () => controller.abort();
        // apply represents model/reasoning/web setters, not a scope change.
    }, [userId, conversationId, key]);
    useEffect(() => {
        if (!userId || loaded !== key) return;
        if (!conversationId) {
            try { localStorage.setItem(`taibu.next-task:${userId}`, JSON.stringify(freshTaskConfiguration(latest.current.configuration))); } catch { /* optional account preference cache */ }
            return;
        }
        const timer = setTimeout(async () => {
            if (saving.current) return;
            saving.current = true;
            try {
                while (true) {
                    const scope = latest.current;
                    if (!scope.userId || !scope.conversationId || scope.loaded !== scope.key) break;
                    const body = JSON.stringify(scope.configuration);
                    if (body === saved.current.get(scope.key)) break;
                    const result = await requestBrowserJson(`/api/conversations/${scope.conversationId}/configuration`, { method: 'PATCH', body, headers: { 'X-Expected-User-Id': scope.userId } });
                    if (result.error) break;
                    saved.current.set(scope.key, body);
                }
            } finally { saving.current = false; }
        }, 500);
        return () => { clearTimeout(timer); };
    }, [userId, conversationId, value, loaded, key]);
}
