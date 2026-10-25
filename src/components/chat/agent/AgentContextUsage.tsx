'use client';
// 'use client'：上下文用量弹层需要开关状态

import { useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentRuntimeInfo } from '@/lib/agent/types';

type AgentContext = NonNullable<AgentRuntimeInfo['context']>;

const number = (value: number) => value.toLocaleString('en-US');
const compact = (value: number) => value < 1000 ? number(value) : `${(value / 1000).toFixed(1)}k`;
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

type ContextSegment = { key: string; label: string; tokens: number; tone: string; deferred?: boolean; count?: number; meta?: string };

/** 本任务用的方法卡：目录随系统提示注入，正文由 load_analysis_method 读进上下文。 */
export interface ContextSkills { listed: boolean; cards: Array<{ id: string; title: string; version: string }> }

/**
 * 上下文分类（claude 会话详情同款解剖）：
 * 消息 / 系统工具 / MCP 工具 / 系统提示 / 技能 / 记忆文件 / MCP 服务器说明 / 自动压缩缓冲 / 空闲空间。
 * taibu 当前只有消息、工具用量与压缩次数有实测值；未接入的分类保留占位行（deferred），不虚构 token。
 * 技能单独一行说明本任务用了哪几张卡：它们的正文已经算在消息里，不重复计 token。
 */
function buildContextSegments(runtime: AgentRuntimeInfo, context: AgentContext, skills?: ContextSkills): ContextSegment[] {
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
        skills
            ? { key: 'skills', label: '技能', tokens: 0, tone: 'skills', meta: skills.cards.length ? `${skills.cards.length} 张已加载` : '未加载' }
            : { key: 'skills', label: '技能', tokens: 0, tone: 'skills', deferred: true, count: 0 },
        { key: 'memory', label: '记忆文件', tokens: 0, tone: 'memory', deferred: true, count: 0 },
        { key: 'mcp-instructions', label: 'MCP 服务器说明', tokens: 0, tone: 'mcp', deferred: true },
        { key: 'buffer', label: '自动压缩缓冲', tokens: buffer, tone: 'buffer' },
        { key: 'free', label: '空闲空间', tokens: free, tone: 'free' },
    ];
}

export function AgentContextOverview({ runtime, working = false, grip, skills, onOpen }: {
    runtime?: AgentRuntimeInfo; working?: boolean; grip?: ReactNode;
    /** 本任务用过的方法卡；省略时技能一行仍是占位。 */
    skills?: ContextSkills;
    onOpen?: (id: string) => void;
}) {
    const [open, setOpen] = useState(true);
    const context = runtime?.context;
    if (!runtime || !context) return <section className="agent-ws-status-card" aria-label="上下文">
        <div className="agent-ws-status-head"><span>上下文</span>{grip}<span className="agent-ws-status-value">—</span></div>
    </section>;
    const capacity = runtime.model.contextWindow;
    const segments = buildContextSegments(runtime, context, skills);
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
                    <dd>{segment.deferred ? '未启用' : segment.meta ?? <>{compact(segment.tokens)}{capacity ? <em>{Math.round(segment.tokens / capacity * 100)}%</em> : null}</>}</dd>
                </div>)}
                {segments.some(segment => segment.key === 'free') && <div className="agent-context-legend-row is-free">
                    <span className="agent-context-dot" data-tone="free" aria-hidden="true" />
                    <dt>空闲空间</dt>
                    <dd>{compact(segments.find(segment => segment.key === 'free')?.tokens ?? 0)}{capacity ? <em>{Math.round((segments.find(segment => segment.key === 'free')?.tokens ?? 0) / capacity * 100)}%</em> : null}</dd>
                </div>}
            </dl>
            {skills && (skills.listed || skills.cards.length > 0) && <div className="agent-rail-body" aria-label="技能与方法">
                {skills.listed && <button type="button" className="agent-rail-row agent-rail-button agent-rail-result" onClick={() => onOpen?.('methods')}>
                    <BookOpen size={15} aria-hidden="true" />
                    <span className="agent-rail-result-text"><span>方法目录</span><small>随任务注入系统提示</small></span>
                </button>}
                {skills.cards.map(card => <button key={card.id} type="button" className="agent-rail-row agent-rail-button agent-rail-result" onClick={() => onOpen?.(card.id)}>
                    <BookOpen size={15} aria-hidden="true" />
                    <span className="agent-rail-result-text"><span>{card.title}</span><small>版本 {card.version} · 已读入上下文</small></span>
                </button>)}
            </div>}
            <p className="agent-context-foot">{approximate ? '数值为估算；' : ''}{working ? '随任务实时更新。' : '发送消息以刷新。'}自动压缩缓冲在接近窗口上限时启用。</p>
        </div>}
    </section>;
}
