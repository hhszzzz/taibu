'use client';
// 'use client'：上下文弹层与技能展开需要开关状态

import { Fragment, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import type { AgentMessageData, AgentRuntimeInfo } from '@/lib/agent/types';
import { buildContextSegments, type ContextSkills } from '@/lib/agent/context-segments';
import { getAgentSkills, type AgentToolPart } from '@/lib/agent/tool-presentation';
import './agent-context-usage.css';

export type { ContextSkills };

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

/**
 * 上下文分类：分段条 + 图例 + 技能行。
 * 上下文卡原先在右侧会话栏；现在只在聊天框下方的上下文环弹层里出现。
 */
export function AgentContextBreakdown({ runtime, skills, onOpen }: {
    runtime: AgentRuntimeInfo;
    /** 本任务用过的方法与技能；省略时技能一行仍是占位。 */
    skills?: ContextSkills;
    onOpen?: (id: string) => void;
}) {
    const [skillsOpen, setSkillsOpen] = useState(false);
    const context = runtime.context;
    if (!context) return null;
    const segments = buildContextSegments(runtime, context, skills);
    const total = segments.reduce((sum, segment) => sum + segment.tokens, 0) || 1;
    const free = segments.find(segment => segment.key === 'free');
    return <div className="agent-context-body">
        <div className="agent-context-bar-stack" role="img" aria-label={`上下文窗口：${segments.map(segment => `${segment.label} ${compact(segment.tokens)}`).join('；')}`}>
            {segments.map(segment => <span key={segment.key} data-tone={segment.tone} style={{ width: `${Math.max(segment.tokens / total * 100, 0)}%` }} />)}
        </div>
        <div className="agent-context-legend">
            {segments.filter(segment => segment.key !== 'free').map(segment => <Fragment key={segment.key}>
                <div className="agent-context-legend-row" data-deferred={segment.deferred || undefined}>
                    <span className="agent-context-dot" data-tone={segment.tone} aria-hidden="true" />
                    <span className="agent-context-legend-label">
                        {segment.key === 'skills' && skills && skills.cards.length > 0
                            ? <Button unstyled type="button" className="agent-context-legend-toggle" aria-expanded={skillsOpen} onClick={() => setSkillsOpen(value => !value)}>
                                <span className="agent-context-legend-toggle-label">{segment.label}</span>
                            </Button>
                            : <>{segment.label}</>}
                    </span>
                    <span className="agent-context-legend-value">{segment.deferred ? '未启用' : compact(segment.tokens)}</span>
                </div>
                {segment.key === 'skills' && skills && skillsOpen && skills.cards.length > 0 && <div className="agent-context-skills" aria-label="技能与方法">
                    {skills.cards.map(card => <Button unstyled key={card.id} type="button" className="agent-context-skill" onClick={() => onOpen?.(card.id)}>
                        <span>{card.title}</span><small>{compact(card.tokens ?? 0)}</small>
                    </Button>)}
                </div>}
            </Fragment>)}
            {free && <div className="agent-context-legend-row is-free">
                <span className="agent-context-dot" data-tone="free" aria-hidden="true" />
                <span className="agent-context-legend-label">空闲空间</span>
                <span className="agent-context-legend-value">{compact(free.tokens)}</span>
            </div>}
        </div>
    </div>;
}

/** chin 行尾的上下文环：环 = 已用上下文占比，点开是分类明细。普通对话没有运行时数据时不显示。 */
export function AgentContextMeter({ data, onOpen }: {
    /** 本对话最近的 Agent 消息；普通对话没有运行时数据，此时不显示环。 */
    data?: AgentMessageData;
    /** 点开技能或方法卡：在右侧工作区打开对应资源。 */
    onOpen?: (id: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const runtime = data?.runtime;
    const tools = useMemo(() => (data?.parts ?? []).filter((part): part is AgentToolPart => part.type === 'tool'), [data?.parts]);
    const skills = useMemo(() => getAgentSkills(tools, runtime?.model.id), [tools, runtime?.model.id]);
    const context = runtime?.context;
    if (!runtime || !context) return null;
    const capacity = runtime.model.contextWindow ?? 0;
    const used = Math.max(context.tokens, 0);
    const percent = capacity > 0 ? Math.min(100, Math.round(used / capacity * 100)) : null;
    const detail = `${compact(used)}${capacity > 0 ? ` / ${compact(capacity)}` : ''}`;
    return <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="chat-context-meter" aria-label={`上下文：${detail}`} title={`上下文：${detail}`}>
            <ContextRing percent={percent} size={18} />
        </PopoverTrigger>
        <PopoverContent side="top" align="end" sideOffset={6} className="chat-context-panel" aria-label="上下文">
            <header className="chat-context-head"><strong>上下文</strong><span>{detail}</span></header>
            <div className="chat-context-divider" />
            <AgentContextBreakdown runtime={runtime} skills={skills}
                onOpen={id => { setOpen(false); onOpen?.(id); }} />
        </PopoverContent>
    </Popover>;
}
