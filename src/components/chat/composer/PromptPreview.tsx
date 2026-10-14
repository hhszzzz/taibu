/**
 * 提示词预览/诊断面板
 *
 * 'use client' 标记说明：
 * - 需要处理用户交互事件（点击展开/收起）
 */
'use client';

import type { PromptLayerDiagnostic } from '@/types';
import { groupPromptLayers } from '@/lib/chat/prompt-labels';
import { useRef, useId } from 'react';
import { X } from 'lucide-react';
import { FloatingPanel } from '@/components/ui/FloatingPanel';

interface PromptPreviewProps {
    embedded?: boolean;
    promptPreviewLoading: boolean;
    hasPromptDiagnostics: boolean;
    promptDiagnosticsOpen: boolean;
    setPromptDiagnosticsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
    contextProgressPercent: number;
    promptProgressPercent: number;
    promptUsageLabel: string;
    promptPreviewTokens: number;
    promptPreviewBudget: number;
    displayLayers: PromptLayerDiagnostic[];
    displayUserMessageTokens: number;
    formatLayerLabel: (layerId: string) => string;
}

export function PromptPreview({
    embedded = false,
    promptPreviewLoading,
    hasPromptDiagnostics,
    promptDiagnosticsOpen,
    setPromptDiagnosticsOpen,
    contextProgressPercent,
    promptProgressPercent,
    promptUsageLabel,
    promptPreviewTokens,
    promptPreviewBudget,
    displayLayers,
    displayUserMessageTokens,
    formatLayerLabel,
}: PromptPreviewProps) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const id = useId();
    const statistics = <>
        <div className="flex items-center justify-between font-medium text-foreground-secondary">
            <span>提示词使用</span><span className="tabular-nums">{promptPreviewTokens} / {promptPreviewBudget}</span>
        </div>
        <div className="w-full bg-border/50 h-1 rounded-full mt-1.5 mb-2 overflow-hidden">
            <div className="h-full bg-accent transition-all duration-300" style={{ width: `${promptProgressPercent}%` }} />
        </div>
        <div className="mt-2 max-h-40 overflow-auto space-y-1">
            {displayUserMessageTokens > 0 && <div className="flex items-center justify-between gap-2">
                <span className="truncate text-foreground">P2 · 用户前缀</span><span className="tabular-nums text-foreground-secondary">{displayUserMessageTokens}</span>
            </div>}
            {groupPromptLayers(displayLayers).map(layer => <div key={layer.id} className="flex items-center justify-between gap-2">
                <span className={`truncate ${layer.included ? 'text-foreground' : 'text-foreground-tertiary line-through'}`}>
                    {layer.priority ? `${layer.priority} · ` : ''}
                    {!layer.included && layer.reason && <span className="text-xs no-underline mr-1">({layer.reason === 'budget_exceeded' ? '超出' : layer.reason === 'empty' ? '空' : '重复'})</span>}
                    {formatLayerLabel(layer.id)}
                </span><span className="tabular-nums text-foreground-secondary">{layer.tokens}</span>
            </div>)}
        </div>
    </>;
    if (embedded) return <details className="agent-context-details">
        <summary aria-label="上下文用量"><span>上下文</span><span>{promptPreviewLoading ? '加载中' : `${contextProgressPercent}%`}</span></summary>
        <div className="text-xs">{hasPromptDiagnostics ? statistics : <p className="chat-model-note">发送消息后显示上下文统计。</p>}</div>
    </details>;
    return (
        <div className="relative group">
            <button
                ref={triggerRef}
                type="button"
                onClick={() => {
                    if (hasPromptDiagnostics) {
                        setPromptDiagnosticsOpen((prev: boolean) => !prev);
                    }
                }}
                className={`relative w-5 h-5 flex items-center justify-center ${promptPreviewLoading ? 'opacity-60' : ''} ${hasPromptDiagnostics ? 'cursor-pointer' : 'cursor-default'}`}
                aria-label="提示词使用情况"
                aria-expanded={hasPromptDiagnostics && promptDiagnosticsOpen}
                aria-haspopup="dialog"
                aria-controls={promptDiagnosticsOpen ? id : undefined}
            >
                <svg viewBox="0 0 36 36" className="w-5 h-5">
                    <path
                        d="M18 2a16 16 0 1 1 0 32a16 16 0 0 1 0-32"
                        fill="none"
                        className="text-border"
                        stroke="currentColor"
                        strokeWidth="3"
                    />
                    <path
                        d="M18 2a16 16 0 1 1 0 32a16 16 0 0 1 0-32"
                        fill="none"
                        className="text-accent"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeDasharray={`${contextProgressPercent}, 100`}
                        strokeLinecap="round"
                    />
                </svg>
                <div className="absolute inset-[3px] rounded-full bg-border/40 overflow-hidden">
                    <div
                        className="absolute inset-x-0 bottom-0 bg-accent"
                        style={{ height: `${promptProgressPercent}%` }}
                    />
                </div>
            </button>
            <div className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-background border border-border px-2 py-1 text-xs text-foreground-secondary opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {promptPreviewLoading
                    ? '正在加载预览'
                    : `上下文 ${contextProgressPercent}% | ${promptUsageLabel}`}
            </div>
            <FloatingPanel open={hasPromptDiagnostics && promptDiagnosticsOpen} anchorRef={triggerRef} onClose={() => setPromptDiagnosticsOpen(false)} id={id} label="提示词使用情况" role="dialog" side="top" align="end" className="w-72 px-3 py-2 text-xs">
                        <button type="button" aria-label="关闭提示词统计" onClick={() => setPromptDiagnosticsOpen(false)}><X size={14} /></button>
                        {statistics}
            </FloatingPanel>
        </div>
    );
}
