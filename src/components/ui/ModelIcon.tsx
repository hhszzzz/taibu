'use client';
// 'use client'：图标组件来自 @lobehub/icons（客户端组件）

import { getVendorIcon } from '@/lib/ai/vendor-config';
import { LobeIcon, hasLobeIcon } from '@/components/ui/LobeIcon';

/** 模型图标：管理员选了 lobehub 图标就用它，否则按供应商显示。 */
export function ModelIcon({ icon, vendor, size = 18, className }: {
    icon?: string | null;
    vendor: string;
    size?: number;
    className?: string;
}) {
    return hasLobeIcon(icon) ? <LobeIcon id={icon} size={size} className={className} /> : <>{getVendorIcon(vendor, size)}</>;
}
