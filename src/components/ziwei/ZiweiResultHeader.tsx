/**
 * 紫微结果页标题区：标题 + 摘要、命盘视图切换（本命 / 运限 / 飞星）、更多操作与「问太卜」。
 *
 * 'use client'：视图切换的方向键导航与「更多」浮层需要 ref 与本地状态。
 */
'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';
import { AIFeatureGate } from '@/components/ai/AIFeatureGate';
import { useTabIndicator } from '@/lib/motion/tab-indicator';
import { ResultMoreActions } from '@/components/divination/ResultMoreActions';
import { ASK_TAIBU_HREF } from '@/components/bazi/result/ResultHeader';
import type { HeaderMenuItem } from '@/components/layout/HeaderMenuContext';

export type ZiweiChartMode = 'natal' | 'horoscope' | 'flying';

export const ZIWEI_CHART_MODES: ReadonlyArray<{ id: ZiweiChartMode; label: string }> = [
    { id: 'natal', label: '本命' },
    { id: 'horoscope', label: '运限' },
    { id: 'flying', label: '飞星' },
];

/** tab 与 tabpanel 的 id，供页面内容区 aria-labelledby 关联。 */
export const ziweiModeTabId = (mode: ZiweiChartMode) => `ziwei-mode-tab-${mode}`;
export const ZIWEI_MODE_PANEL_ID = 'ziwei-mode-panel';

interface ZiweiResultHeaderProps {
    title: string;
    /** 摘要（五行局 · 命宫 · 身宫 · 当前大限）；desktopSuffix 只在桌面端追加（如大限岁数）。 */
    summary: string;
    desktopSuffix?: string;
    /** 摘要后的附加状态（如时辰微调提示）。 */
    status?: ReactNode;
    mode: ZiweiChartMode;
    onModeChange: (mode: ZiweiChartMode) => void;
    /** 带上当前命盘进入 AI 对话；缺省时跳转 AI 对话「问太卜」。 */
    onAsk?: () => void;
    /** 桌面端「更多」菜单项；移动端同一组操作由顶栏三点菜单承载。 */
    actions: HeaderMenuItem[];
}

function ModeTabs({ mode, onModeChange }: { mode: ZiweiChartMode; onModeChange: (mode: ZiweiChartMode) => void }) {
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const listRef = useRef<HTMLDivElement>(null);
    useTabIndicator(listRef);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const current = ZIWEI_CHART_MODES.findIndex((item) => item.id === mode);
        const last = ZIWEI_CHART_MODES.length - 1;
        const next = event.key === 'ArrowRight' ? (current + 1) % ZIWEI_CHART_MODES.length
            : event.key === 'ArrowLeft' ? (current - 1 + ZIWEI_CHART_MODES.length) % ZIWEI_CHART_MODES.length
                : event.key === 'Home' ? 0
                    : event.key === 'End' ? last
                        : null;
        if (next === null) return;
        event.preventDefault();
        onModeChange(ZIWEI_CHART_MODES[next].id);
        tabRefs.current[next]?.focus();
    };

    return (
        <div
            ref={listRef}
            role="tablist"
            aria-label="命盘视图"
            onKeyDown={handleKeyDown}
            className="motion-tabs motion-tabs--pill grid h-10 grid-cols-3 gap-1 rounded-xl bg-background-secondary p-1 lg:flex"
        >
            {ZIWEI_CHART_MODES.map((item, index) => {
                const selected = item.id === mode;
                return (
                    <Button unstyled
                        key={item.id}
                        ref={(node) => { tabRefs.current[index] = node; }}
                        id={ziweiModeTabId(item.id)}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={ZIWEI_MODE_PANEL_ID}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onModeChange(item.id)}
                        className={`rounded-[7px] text-sm transition-colors lg:px-3.5 ${selected
                            ? 'bg-surface text-foreground shadow-[var(--shadow-sm)]'
                            : 'text-foreground-secondary hover:text-foreground'}`}
                    >
                        {item.label}
                    </Button>
                );
            })}
        </div>
    );
}

export function ZiweiResultHeader({ title, summary, desktopSuffix, status, mode, onModeChange, onAsk, actions }: ZiweiResultHeaderProps) {
    return (
        <header className="flex flex-col gap-3.5 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between lg:gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
                {/* 移动端标题由顶栏承担（useHeaderTitle） */}
                <h1 className="hidden break-words font-display text-[32px] font-normal leading-tight lg:block">{title}</h1>
                <p className="px-1 text-center text-[0.8125rem] leading-normal text-foreground-secondary lg:px-0 lg:text-left lg:text-sm">
                    {summary}
                    {desktopSuffix && <span className="hidden lg:inline">{desktopSuffix}</span>}
                    {status}
                </p>
            </div>
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 lg:flex-none">
                    <ModeTabs mode={mode} onModeChange={onModeChange} />
                </div>
                <div className="hidden items-center gap-2 lg:flex">
                    <ResultMoreActions actions={actions} label="命盘操作" />
                    <AIFeatureGate>
                        {onAsk ? (
                            <Button unstyled type="button" onClick={onAsk}
                                className="inline-flex h-8 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                            >
                                问太卜
                            </Button>
                        ) : (
                            <Link
                                href={ASK_TAIBU_HREF}
                                className="inline-flex h-8 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                            >
                                问太卜
                            </Link>
                        )}
                    </AIFeatureGate>
                </div>
            </div>
        </header>
    );
}
