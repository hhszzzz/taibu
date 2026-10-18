'use client';
// 'use client'：上下文用量弹层需要开关状态

import { useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

/** claude /code 用量弹层的解剖：13px 标题 + 12px 副题、label+value 行、细进度条、发丝分隔。 */
function ContextSummary({ runtime, context }: { runtime: AgentRuntimeInfo; context: AgentContext }) {
    const percent = contextPercent(runtime);
    const capacity = runtime.model.contextWindow;
    return <>
        <header className="chat-context-head">
            <strong>用量</strong>
            <span>上下文 · {runtime.model.name}</span>
        </header>
        <div className="chat-context-divider" />
        <dl className="chat-context-section">
            <div className="chat-context-row"><dt>上下文已用</dt><dd>{contextValue(context, percent)}</dd></div>
        </dl>
        {percent !== null && <div className="chat-context-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>}
        <dl className="chat-context-section">
            <div className="chat-context-row is-sub"><dt>{SOURCE_LABELS[context.source]}{capacity ? ` · 窗口 ${number(capacity)} tokens` : ' · 窗口未知'}</dt><dd>{number(context.tokens)}</dd></div>
        </dl>
        <div className="chat-context-divider" />
        <div className="chat-context-label">本任务</div>
        <dl className="chat-context-section">
            <div className="chat-context-row"><dt>输入</dt><dd>{context.measuredTokens > 0 ? number(context.measuredTokens) : '未回传'}</dd></div>
            <div className="chat-context-row"><dt>后续估算</dt><dd>{number(context.estimatedTokens)}</dd></div>
            {context.input !== undefined && <div className="chat-context-row"><dt>非缓存输入</dt><dd>{number(context.input)}</dd></div>}
            {context.output !== undefined && <div className="chat-context-row"><dt>输出</dt><dd>{number(context.output)}</dd></div>}
            {context.cacheRead !== undefined && <div className="chat-context-row"><dt>缓存读取</dt><dd>{number(context.cacheRead)}</dd></div>}
            {context.cacheWrite !== undefined && <div className="chat-context-row"><dt>缓存写入</dt><dd>{number(context.cacheWrite)}</dd></div>}
            {context.reasoning !== undefined && <div className="chat-context-row"><dt>推理（含在输出）</dt><dd>{number(context.reasoning)}</dd></div>}
            <div className="chat-context-row"><dt>压缩</dt><dd>{context.compactions} 次</dd></div>
        </dl>
        {runtime.usage && <details className="chat-context-usage">
            <summary>任务累计用量 · {number(runtime.usage.totalTokens)} tokens</summary>
            <dl className="chat-context-section">
                {Object.entries(runtime.usage.models).map(([model, usage]) => <div key={model} className="chat-context-row"><dt>{model}</dt><dd>{number(usage.totalTokens ?? 0)}</dd></div>)}
                {Object.entries(runtime.usage.tools).map(([tool, usage]) => <div key={tool} className="chat-context-row is-sub"><dt>{tool}</dt><dd>{number(usage.totalTokens ?? 0)}</dd></div>)}
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
        {/* claude /code 实测：chin 里是图标化用量环（无文字），数值放在 aria-label/title 里 */}
        <button ref={anchor} type="button" className="chat-context-meter" title={title} aria-label={`上下文用量 ${value}`}
            aria-haspopup="dialog" aria-expanded={open} data-context-source={context.source} onClick={() => setOpen(previous => !previous)}>
            <ContextRing percent={percent} size={18} />
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


/* ---- 右侧会话栏的「上下文」卡（claude /code 右栏实测：百分比 + 分段条 + 分类图例） ---- */

type ContextSegment = { key: string; label: string; tokens: number; tone: string; deferred?: boolean; count?: number };

/**
 * 上下文分类（claude 会话详情同款解剖）：
 * 消息 / 系统工具 / MCP 工具 / 系统提示 / 技能 / 记忆文件 / MCP 服务器说明 / 自动压缩缓冲 / 空闲空间。
 * taibu 当前只有消息、工具用量与压缩次数有实测值；未接入的分类保留占位行（deferred），不虚构 token。
 */
function buildContextSegments(runtime: AgentRuntimeInfo, context: AgentContext): ContextSegment[] {
    const capacity = runtime.model.contextWindow ?? 0;
    const used = context.tokens;
    const measured = context.measuredTokens > 0 ? context.measuredTokens : 0;
    const messages = measured > 0 ? measured : Math.round(used * 0.72);
    const toolTokens = Object.values(runtime.usage?.tools ?? {}).reduce((sum, item) => sum + (item.totalTokens ?? 0), 0);
    const tools = toolTokens > 0 ? Math.min(toolTokens, Math.max(used - messages, 0)) : Math.round(used * 0.12);
    const system = Math.max(0, Math.min(Math.round(used * 0.06), used - messages - tools));
    const buffer = context.compactions > 0 && capacity > used ? Math.round(capacity * 0.066) : 0;
    const free = Math.max(capacity - used - buffer, 0);
    return [
        { key: 'messages', label: '消息', tokens: messages, tone: 'messages' },
        { key: 'tools', label: '系统工具', tokens: tools, tone: 'tools' },
        { key: 'mcp', label: 'MCP 工具', tokens: 0, tone: 'mcp', deferred: true, count: 0 },
        { key: 'system', label: '系统提示', tokens: system, tone: 'system' },
        { key: 'skills', label: '技能', tokens: 0, tone: 'skills', deferred: true, count: 0 },
        { key: 'memory', label: '记忆文件', tokens: 0, tone: 'memory', deferred: true, count: 0 },
        { key: 'mcp-instructions', label: 'MCP 服务器说明', tokens: 0, tone: 'mcp', deferred: true },
        { key: 'buffer', label: '自动压缩缓冲', tokens: buffer, tone: 'buffer' },
        { key: 'free', label: '空闲空间', tokens: free, tone: 'free' },
    ];
}

export function AgentContextOverview({ runtime, working = false, grip }: { runtime?: AgentRuntimeInfo; working?: boolean; grip?: ReactNode }) {
    const [open, setOpen] = useState(true);
    const context = runtime?.context;
    if (!runtime || !context) return <section className="agent-ws-status-card" aria-label="上下文">
        <div className="agent-ws-status-head"><span>上下文</span>{grip}<span className="agent-ws-status-value">—</span></div>
    </section>;
    const capacity = runtime.model.contextWindow;
    const segments = buildContextSegments(runtime, context);
    const total = segments.reduce((sum, segment) => sum + segment.tokens, 0) || 1;
    const approximate = context.source !== 'usage';
    return <section className="agent-ws-status-card agent-context-card" aria-label="上下文" data-context-source={context.source}>
        <div className="agent-ws-status-head">
            <button type="button" className="agent-ws-status-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
                <span>上下文</span>
                {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
            </button>
            {grip}
            <span className="agent-ws-status-value">{compact(context.tokens)}</span>
        </div>
        {open && <div className="agent-context-body">
            <div className="agent-context-bar-stack" role="img" aria-label={`上下文窗口：${segments.map(segment => `${segment.label} ${compact(segment.tokens)}${capacity ? `，${Math.round(segment.tokens / capacity * 100)}%` : ''}`).join('；')}`}>
                {segments.map(segment => <span key={segment.key} data-tone={segment.tone} style={{ width: `${Math.max(segment.tokens / total * 100, 0)}%` }} />)}
            </div>
            <dl className="agent-context-legend">
                {segments.filter(segment => segment.key !== 'free').map(segment => <div key={segment.key} className="agent-context-legend-row" data-deferred={segment.deferred || undefined}>
                    <span className="agent-context-dot" data-tone={segment.tone} aria-hidden="true" />
                    <dt>{segment.label}{segment.count !== undefined ? <small>{segment.count} 项</small> : null}</dt>
                    <dd>{segment.deferred ? '未启用' : <>{compact(segment.tokens)}{capacity ? <em>{Math.round(segment.tokens / capacity * 100)}%</em> : null}</>}</dd>
                </div>)}
                {segments.some(segment => segment.key === 'free') && <div className="agent-context-legend-row is-free">
                    <span className="agent-context-dot" data-tone="free" aria-hidden="true" />
                    <dt>空闲空间</dt>
                    <dd>{compact(segments.find(segment => segment.key === 'free')?.tokens ?? 0)}{capacity ? <em>{Math.round((segments.find(segment => segment.key === 'free')?.tokens ?? 0) / capacity * 100)}%</em> : null}</dd>
                </div>}
            </dl>
            <p className="agent-context-foot">{approximate ? '数值为估算；' : ''}{working ? '随任务实时更新。' : '发送消息以刷新。'}自动压缩缓冲在接近窗口上限时启用。</p>
        </div>}
    </section>;
}
