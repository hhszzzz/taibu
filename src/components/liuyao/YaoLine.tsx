/**
 * 爻线组件
 * 
 * 显示单个爻：
 * - 阳爻：实线 ———
 * - 阴爻：断开 — —
 * - 变爻：红色高亮
 */
'use client';

import { type Yao } from '@/lib/divination/liuyao';

interface YaoLineProps {
    yao: Yao;
    size?: 'sm' | 'md' | 'lg';
    showLabel?: boolean;
}

const YAO_LABELS = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];

export function YaoLine({ yao, size = 'md', showLabel = false }: YaoLineProps) {
    const isChanging = yao.change === 'changing';
    const isYang = yao.type === 1;

    const sizeClasses = {
        sm: { line: 'h-2', gap: 'gap-1', width: 'w-16', halfWidth: 'w-[28px]', gapWidth: 'w-[8px]' },
        md: { line: 'h-3', gap: 'gap-1.5', width: 'w-24', halfWidth: 'w-[44px]', gapWidth: 'w-[8px]' },
        lg: { line: 'h-4', gap: 'gap-2', width: 'w-32', halfWidth: 'w-[60px]', gapWidth: 'w-[8px]' },
    };

    const { line, gap, width, halfWidth, gapWidth } = sizeClasses[size];

    const lineColor = isChanging
        ? 'bg-accent'
        : 'bg-foreground';

    return (
        <div className={`flex items-center ${gap} ${showLabel ? 'justify-between' : 'justify-center'}`}>
            {showLabel && (
                <span className={`text-xs w-12 ${isChanging ? 'text-accent font-medium' : 'text-foreground-secondary'}`}>
                    {YAO_LABELS[yao.position - 1]}
                    {isChanging && ' ○'}
                </span>
            )}
            <div className={`flex items-center justify-center ${width}`}>
                {isYang ? (
                    // 阳爻：完整实线
                    <div className={`w-full ${line} rounded-sm ${lineColor}`} />
                ) : (
                    // 阴爻：断开的两段
                    <>
                        <div className={`${halfWidth} ${line} rounded-sm ${lineColor}`} />
                        <div className={gapWidth} /> {/* 中间空隙 */}
                        <div className={`${halfWidth} ${line} rounded-sm ${lineColor}`} />
                    </>
                )}
            </div>
        </div>
    );
}
