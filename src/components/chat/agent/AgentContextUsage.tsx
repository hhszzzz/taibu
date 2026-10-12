'use client';
// 'use client'：上下文用量弹层需要开关状态

import { useRef, useState } from 'react';
import type { AgentRuntimeInfo } from '@/lib/agent/types';
import { FloatingPanel } from '@/components/ui/FloatingPanel';

type AgentContext = NonNullable<AgentRuntimeInfo['context']>;

const number = (value: number) => value.toLocaleString('en-US');
const compact = (value: number) => value < 1000 ? number(value) : `${(value / 1000).toFixed(1)}k`;
const SOURCE_LABELS: Record<AgentContext['source'], string> = { usage: '已测', mixed: '已测基准 + 后续估算', estimated: '估算' };

/** Share of the configured window, or null when the model has no configured limit. */
function contextPercent(runtime?: AgentRuntimeInfo): number | null {
    const capacity = runtime?.model.contextWindow;
    const tokens = runtime?.context?.tokens;
    return tokens !== undefined && capacity && capacity > 0 ? Math.min(100, Math.round(tokens / capacity * 100)) : null;
}

/** Short reading such as 38%, ≈ 12.4k or ≈38%; estimates carry ≈. */
function contextValue(context: AgentContext, percent: number | null): string {
    const approximate = context.source === 'estimated' ? '≈' : '';
    return percent === null ? `${approximate ? '≈ ' : ''}${compact(context.tokens)}` : `${approximate}${percent}%`;
}

export function ContextRing({ percent, size }: { percent: number | null; size: number }) {
    const stroke = size > 24 ? 6 : 2.5;
    const radius = (size - stroke) / 2;
    const length = 2 * Math.PI * radius;
    return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="chat-context-ring">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="chat-context-track" />
        {percent !== null && <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${length * percent / 100} ${length}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="chat-context-value" />}
    </svg>;
}

/** Ring, total and counters for the latest model context. */
function ContextSummary({ runtime, context }: { runtime: AgentRuntimeInfo; context: AgentContext }) {
    const percent = contextPercent(runtime);
    const capacity = runtime.model.contextWindow;
    return <>
        <div className="chat-context-summary">
            <ContextRing percent={percent} size={56} />
            <div>
                <strong>{contextValue(context, percent)}</strong>
                <span>{SOURCE_LABELS[context.source]}{capacity ? ' · 应用配置上限' : ''}</span>
                <span>{context.source === 'estimated' ? '≈ ' : ''}{number(context.tokens)} / {capacity ? number(capacity) : '容量未知'} tokens · {runtime.model.name}</span>
            </div>
        </div>
        <dl className="chat-context-stats">
            <div><dt>输入</dt><dd>{context.measuredTokens > 0 ? number(context.measuredTokens) : '未回传'}</dd></div>
            <div><dt>后续估算</dt><dd>{number(context.estimatedTokens)}</dd></div>
            {context.input !== undefined && <div><dt>非缓存输入</dt><dd>{number(context.input)}</dd></div>}
            {context.output !== undefined && <div><dt>输出</dt><dd>{number(context.output)}</dd></div>}
            {context.cacheRead !== undefined && <div><dt>缓存读取</dt><dd>{number(context.cacheRead)}</dd></div>}
            {context.cacheWrite !== undefined && <div><dt>缓存写入</dt><dd>{number(context.cacheWrite)}</dd></div>}
            {context.reasoning !== undefined && <div><dt>推理（含在输出）</dt><dd>{number(context.reasoning)}</dd></div>}
            <div><dt>压缩</dt><dd>{context.compactions} 次</dd></div>
        </dl>
        {runtime.usage && <details className="chat-context-usage">
            <summary>任务累计用量 · {number(runtime.usage.totalTokens)} tokens</summary>
            <dl className="chat-context-stats">
                {Object.entries(runtime.usage.models).map(([model, usage]) => <div key={model}><dt>{model}</dt><dd>{number(usage.totalTokens ?? 0)}</dd></div>)}
                {Object.entries(runtime.usage.tools).map(([tool, usage]) => <div key={tool}><dt>{tool}</dt><dd>{number(usage.totalTokens ?? 0)}</dd></div>)}
            </dl>
            <p className="chat-model-note">按服务商回传统计。未回传 token 的本地计算不计入；金额未配置。</p>
        </details>}
        <p className="chat-model-note">{capacity ? '窗口上限来自应用的模型配置。' : '未知模型不显示百分比，只显示 token 数。'}</p>
    </>;
}

/** Composer reading of the latest task context; opens the counters on demand. */
export function AgentContextMeter({ runtime }: { runtime?: AgentRuntimeInfo }) {
    const anchor = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const context = runtime?.context;
    if (!runtime || !context) return null;
    const percent = contextPercent(runtime);
    const value = contextValue(context, percent);
    const title = percent === null ? `上下文：${number(context.tokens)} tokens，模型未配置窗口上限` : `上下文：${SOURCE_LABELS[context.source]} ${percent}%，应用配置上限`;
    return <>
        <button ref={anchor} type="button" className="chat-context-meter" title={title} aria-label={`上下文用量 ${value}`}
            aria-haspopup="dialog" aria-expanded={open} data-context-source={context.source} onClick={() => setOpen(previous => !previous)}>
            <ContextRing percent={percent} size={18} /><span>{value}</span>
        </button>
        <FloatingPanel open={open} anchorRef={anchor} onClose={() => setOpen(false)} label="上下文用量" role="dialog" side="top" align="end" className="chat-context-panel">
            <ContextSummary runtime={runtime} context={context} />
        </FloatingPanel>
    </>;
}

/** 41%（已测）· 未压缩: the latest context reading in one line, or null before the task measured any. */
export function describeAgentContext(runtime?: AgentRuntimeInfo): string | null {
    const context = runtime?.context;
    if (!context) return null;
    return `${contextValue(context, contextPercent(runtime))}（${SOURCE_LABELS[context.source]}）· ${context.compactions ? `已压缩 ${context.compactions} 次` : '未压缩'}`;
}

/** Workspace disclosure with the same counters as the composer meter. */
export function AgentContextDetails({ runtime }: { runtime?: AgentRuntimeInfo }) {
    const context = runtime?.context;
    const percent = contextPercent(runtime);
    return <details className="agent-context-details" data-context-source={context?.source ?? 'unavailable'}>
        <summary aria-label="上下文用量">上下文<span>{context ? contextValue(context, percent) : '—'}</span></summary>
        <div className="agent-context-panel">
            {runtime && context ? <ContextSummary runtime={runtime} context={context} /> : <p className="chat-model-note">任务开始后显示上下文数据。</p>}
        </div>
    </details>;
}
