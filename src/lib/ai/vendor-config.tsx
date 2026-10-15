/**
 * AI 供应商图标配置
 *
 * 'use client' - 包含 React 组件（@lobehub/icons）
 *
 * 仅负责 vendor → 图标映射，名称映射在 vendor-labels.ts 中（纯数据，测试安全）。
 */
'use client';

import type { ComponentType, ReactNode } from 'react';
import {
    DeepSeek,
    Zhipu,
    Gemini,
    Qwen,
    Moonshot,
    OpenAI,
    Claude,
    Google,
    XAI,
    Minimax,
} from '@lobehub/icons';
import { Sparkles } from 'lucide-react';

type VendorIconProps = {
    className?: string;
    color?: string;
    size?: number | string;
};

type VendorIconComponent = ComponentType<VendorIconProps> & {
    Color?: ComponentType<VendorIconProps>;
};

const vendorIcons: Record<string, VendorIconComponent> = {
    openai: OpenAI,
    anthropic: Claude,
    google: Google,
    deepseek: DeepSeek,
    glm: Zhipu,
    gemini: Gemini,
    qwen: Qwen,
    moonshot: Moonshot,
    xai: XAI,
    minimax: Minimax,
};

const fallbackIcon = (s = 18) => <Sparkles size={s} className="text-foreground-secondary" />;

export function getVendorIcon(vendor: string, size?: number): ReactNode {
    const Icon = vendorIcons[vendor];
    if (!Icon) {
        return fallbackIcon(size);
    }

    const ColorIcon = Icon.Color;
    if (ColorIcon) {
        return <ColorIcon size={size ?? 18} className="shrink-0" />;
    }

    // 只有单色版本的标志（OpenAI、Kimi、xAI）跟随文字颜色：
    // 它们的品牌主色是纯黑或纯白（xAI 为 #fff），固定取色会在某一主题下看不见。
    return (
        <Icon
            size={size ?? 18}
            color="currentColor"
            className="shrink-0"
        />
    );
}
