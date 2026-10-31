'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { CustomProviderConfig } from '@/types';
import { CUSTOM_PROVIDER_CHANGED_EVENT, CUSTOM_PROVIDER_STORAGE_KEY, parseStoredCustomProvider } from '@/lib/chat/custom-provider';

function subscribe(onChange: () => void) {
    window.addEventListener(CUSTOM_PROVIDER_CHANGED_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
        window.removeEventListener(CUSTOM_PROVIDER_CHANGED_EVENT, onChange);
        window.removeEventListener('storage', onChange);
    };
}

/** 当前标签页启用的自定义模型；随设置页启用、停用即时更新，服务端渲染时为 null。 */
export function useCustomProvider(): CustomProviderConfig | null {
    // 快照取原始字符串，内容不变时引用稳定。
    const stored = useSyncExternalStore(subscribe, () => sessionStorage.getItem(CUSTOM_PROVIDER_STORAGE_KEY), () => null);
    return useMemo(() => parseStoredCustomProvider(stored), [stored]);
}
