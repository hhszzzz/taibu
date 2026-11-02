'use client';
// 图标来自 @lobehub/icons（客户端组件）

import { LobeIcon, hasLobeIcon } from '@/components/ui/LobeIcon';
import { matchModelIcon } from '@/lib/ai/lobe-icons';
import { registeredClientModelIcon } from '@/lib/ai/model-name-cache';
import { getVendorIcon } from '@/lib/ai/vendor-config';

/** 协作成员的模型图标：记录里带的，否则按模型 ID 认 lobehub 图标，再否则按供应商；都认不出时是通用图标。 */
export function ModelAvatar({ member, size = 14, className = '' }: { member: { vendor?: string; model?: string; icon?: string | null }; size?: number; className?: string }) {
    const icon = member.icon ?? registeredClientModelIcon(member.model) ?? matchModelIcon(member.model);
    return <span className={`agent-model-avatar ${className}`} aria-hidden="true">
        {hasLobeIcon(icon) ? <LobeIcon id={icon} size={size} /> : getVendorIcon(member.vendor ?? '', size)}
    </span>;
}
