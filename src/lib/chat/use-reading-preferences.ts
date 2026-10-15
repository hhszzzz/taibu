'use client';
import { useEffect, useRef, useState } from 'react';
import { getCurrentUserSettings, updateCurrentUserSettings } from '@/lib/user/settings';
import { DEFAULT_CHAT_PREFERENCES, type ChatPreferences } from './preferences';
import { useTheme } from '@/components/ui/ThemeProvider';
import { useToast } from '@/components/ui/Toast';

export function useReadingPreferences(userId: string | null) {
    const [preferences, setPreferences] = useState(DEFAULT_CHAT_PREFERENCES);
    const { setFontScale } = useTheme();
    const { showToast } = useToast();
    const pending = useRef<{ userId: string; width: number } | null>(null);
    const saving = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        pending.current = null;
        setPreferences(DEFAULT_CHAT_PREFERENCES);
        if (!userId) return;
        const controller = new AbortController();
        void getCurrentUserSettings({ expectedUserId: userId, signal: controller.signal }).then(result => {
            if (!controller.signal.aborted && result.settings) {
                setPreferences(current => pending.current?.userId === userId ? { ...result.settings!.chatPreferences, width: current.width } : result.settings!.chatPreferences);
                setFontScale(result.settings.chatPreferences.fontScale);
            }
        }).catch(() => { /* 卸载或切换账号时请求被中止，保留默认阅读偏好 */ });
        return () => controller.abort();
        // Theme setters don't represent an account change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);
    const update = (patch: Pick<ChatPreferences, 'width'>) => {
        const next = { ...preferences, ...patch };
        setPreferences(next);
        if (!userId) return;
        pending.current = { userId, width: next.width };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
            if (saving.current) return;
            saving.current = true;
            try {
                while (pending.current) {
                    const item = pending.current;
                    pending.current = null;
                    // Read the current font/notification preferences before a width-only write.
                    const current = await getCurrentUserSettings({ expectedUserId: item.userId });
                    if (!current.settings) { showToast('error', '阅读宽度未保存，请重试'); continue; }
                    const result = await updateCurrentUserSettings({ chatPreferences: { ...current.settings.chatPreferences, width: item.width } }, undefined, { expectedUserId: item.userId });
                    if (!result) showToast('error', '阅读宽度未保存，请重试');
                }
            } finally { saving.current = false; }
        }, 500);
    };
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    return { preferences, update };
}
