'use client';
// 供应商图标来自 @lobehub/icons（客户端组件）

import { getVendorIcon } from '@/lib/ai/vendor-config';
import { matchModelVendor } from '@/lib/ai/vendor-match';

/** 协作成员用的是哪家的模型：优先取配置里的供应商，否则按模型 ID 前缀推断。 */
export function memberVendor(member: { vendor?: string; model?: string }): string {
    return member.vendor ?? (member.model ? matchModelVendor(member.model) : null) ?? '';
}

/** 协作成员的模型图标；认不出供应商时是通用图标。 */
export function ModelAvatar({ member, size = 14, className = '' }: { member: { vendor?: string; model?: string }; size?: number; className?: string }) {
    return <span className={`agent-model-avatar ${className}`} aria-hidden="true">{getVendorIcon(memberVendor(member), size)}</span>;
}
