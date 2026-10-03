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
    colorPrimary?: string;
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

const iconColorFallback = 'currentColor';
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

    const monoColor = Icon.colorPrimary ?? iconColorFallback;

    return (
        <Icon
            size={size ?? 18}
            color={monoColor}
            className="shrink-0"
        />
    );
}
