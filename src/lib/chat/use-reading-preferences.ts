'use client';
import { useEffect, useState } from 'react';
import { getCurrentUserSettings } from '@/lib/user/settings';
import { DEFAULT_CHAT_PREFERENCES } from './preferences';
import { useTheme } from '@/components/ui/ThemeProvider';

/** Reading column width and font scale from the account's chat preferences (edited in settings). */
export function useReadingPreferences(userId: string | null) {
    const [preferences, setPreferences] = useState(DEFAULT_CHAT_PREFERENCES);
    const { setFontScale } = useTheme();
    const [prevUserId, setPrevUserId] = useState(userId);
    if (prevUserId !== userId) {
        setPrevUserId(userId);
        setPreferences(DEFAULT_CHAT_PREFERENCES);
    }
    useEffect(() => {
        if (!userId) return;
        const controller = new AbortController();
        void getCurrentUserSettings({ expectedUserId: userId, signal: controller.signal }).then(result => {
            if (!controller.signal.aborted && result.settings) {
                setPreferences(result.settings.chatPreferences);
                setFontScale(result.settings.chatPreferences.fontScale);
            }
        }).catch(() => { /* 卸载或切换账号时请求被中止，保留默认阅读偏好 */ });
        return () => controller.abort();
        // Theme setters don't represent an account change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);
    return { preferences };
}
