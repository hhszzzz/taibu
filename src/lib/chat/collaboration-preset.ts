/**
 * 多模型协作预设（claude「多模型协作」放在设置里编辑；模型菜单只保留勾选开关）。
 *
 * 预设按用户存 localStorage：成员名称 / 模型 / 分工 / 推理档位。
 * 聊天页的模型菜单读取同一份预设来装载协作成员；设置页负责编辑。
 *
 * 'use client' 标记说明：
 * - 依赖 useSyncExternalStore 与 localStorage
 */
'use client';

import { useSyncExternalStore } from 'react';
import type { AgentCollaborator } from '@/lib/chat/model-settings';

export interface CollaborationPreset {
    enabled: boolean;
    members: AgentCollaborator[];
    /** 最近一次在设置里修改的时间；聊天页据此把新配置同步到已打开的会话。 */
    updatedAt: number;
}

export const COLLABORATION_PRESET_DEFAULTS: CollaborationPreset = { enabled: false, members: [], updatedAt: 0 };

const EVENT = 'taibu:collaboration-preset';
const keyFor = (userId: string) => `taibu:collaboration-preset:${userId}`;

function parse(value: unknown): CollaborationPreset {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return COLLABORATION_PRESET_DEFAULTS;
    const input = value as Record<string, unknown>;
    const members = Array.isArray(input.members) ? input.members.flatMap((item): AgentCollaborator[] => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const member = item as Record<string, unknown>;
        if (typeof member.id !== 'string' || typeof member.name !== 'string' || typeof member.model !== 'string'
            || (member.reasoning !== undefined && typeof member.reasoning !== 'boolean')) return [];
        return [{
            id: member.id,
            name: member.name,
            model: member.model,
            focus: typeof member.focus === 'string' ? member.focus : '',
            reasoning: member.reasoning === true,
            reasoningEffort: typeof member.reasoningEffort === 'string' ? member.reasoningEffort as AgentCollaborator['reasoningEffort'] : null,
        }];
    }).slice(0, 4) : [];
    return { enabled: input.enabled === true, members, updatedAt: typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : 0 };
}

/** One stable snapshot per stored string: useSyncExternalStore requires reference equality. */
let snapshot: { key: string; value: CollaborationPreset } = { key: '', value: COLLABORATION_PRESET_DEFAULTS };

export function readCollaborationPreset(userId: string | null): CollaborationPreset {
    if (!userId || typeof window === 'undefined') return COLLABORATION_PRESET_DEFAULTS;
    try {
        const raw = window.localStorage.getItem(keyFor(userId)) ?? 'null';
        const key = `${userId}\u0000${raw}`;
        if (snapshot.key === key) return snapshot.value;
        snapshot = { key, value: parse(JSON.parse(raw)) };
        return snapshot.value;
    } catch {
        return COLLABORATION_PRESET_DEFAULTS;
    }
}

export function writeCollaborationPreset(userId: string | null, next: Pick<CollaborationPreset, 'enabled' | 'members'>): void {
    if (!userId || typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(keyFor(userId), JSON.stringify({ enabled: next.enabled, members: next.members, updatedAt: Date.now() }));
    } catch {
        /* 隐私模式：本次会话仍通过事件生效 */
    }
    window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
        window.removeEventListener(EVENT, onChange);
        window.removeEventListener('storage', onChange);
    };
}

export function useCollaborationPreset(userId: string | null): CollaborationPreset {
    return useSyncExternalStore(subscribe, () => readCollaborationPreset(userId), () => COLLABORATION_PRESET_DEFAULTS);
}
