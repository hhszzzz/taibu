'use client';
// 'use client'：按需下载 lobehub 图标组件，并在模块里缓存给所有实例共用

import { createElement, useEffect, useSyncExternalStore } from 'react';
import type { IconType } from '@lobehub/icons/es/types';
import { LOBE_ICON_LOADERS } from '@/lib/ai/lobe-icon-loaders.generated';
import { cn } from '@/lib/utils';

const loaded = new Map<string, IconType>();
const pending = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<() => void>>();
const subscriptions = new Map<string, (listener: () => void) => () => void>();

function subscribe(id: string) {
    let subscription = subscriptions.get(id);
    if (!subscription) {
        subscription = (listener: () => void) => {
            const set = listeners.get(id) ?? new Set<() => void>();
            listeners.set(id, set);
            set.add(listener);
            return () => { set.delete(listener); };
        };
        subscriptions.set(id, subscription);
    }
    return subscription;
}

function load(id: string): Promise<void> {
    const loader = LOBE_ICON_LOADERS[id];
    if (!loader || loaded.has(id)) return Promise.resolve();
    let request = pending.get(id);
    if (!request) {
        request = loader().then(
            module => { loaded.set(id, module.default); listeners.get(id)?.forEach(listener => listener()); },
            () => undefined,
        ).finally(() => pending.delete(id));
        pending.set(id, request);
    }
    return request;
}

export function hasLobeIcon(id: string | null | undefined): id is string {
    return !!id && Object.hasOwn(LOBE_ICON_LOADERS, id);
}

/** 先下载一组图标（如模型菜单里用到的），打开菜单时不再逐个出现。 */
export function preloadLobeIcons(ids: Iterable<string | null | undefined>) {
    for (const id of ids) if (hasLobeIcon(id)) void load(id);
}

/** lobehub 图标；下载完成前是同尺寸的空位，不会挤动布局。 */
export function LobeIcon({ id, size = 18, className }: { id: string; size?: number; className?: string }) {
    const Icon = useSyncExternalStore(subscribe(id), () => loaded.get(id) ?? null, () => null);
    useEffect(() => { void load(id); }, [id]);
    if (!Icon) return <span aria-hidden="true" className={cn('inline-block shrink-0', className)} style={{ width: size, height: size }} />;
    return createElement(Icon, { size, 'aria-hidden': true, className: cn('shrink-0', className) });
}
