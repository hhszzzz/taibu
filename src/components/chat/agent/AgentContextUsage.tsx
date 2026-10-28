'use client';
// 'use client'：上下文用量弹层需要开关状态

import { useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import type { AgentRuntimeInfo } from '@/lib/agent/types';
import { buildContextSegments, type ContextSkills } from '@/lib/agent/context-segments';
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

export function AgentContextOverview({ runtime, working = false, grip, skills, onOpen }: {
    runtime?: AgentRuntimeInfo; working?: boolean; grip?: ReactNode;
    /** 本任务用过的方法与技能；省略时技能一行仍是占位。 */
    skills?: ContextSkills;
    onOpen?: (id: string) => void;
}) {
    const [open, setOpen] = useState(true);
    const [skillsOpen, setSkillsOpen] = useState(false);
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
                    <dt>{segment.key === 'skills' && skills
                        ? <button type="button" className="agent-context-legend-toggle" aria-expanded={skillsOpen} onClick={() => setSkillsOpen(value => !value)}>
                            {segment.label}<ChevronDown size={11} aria-hidden="true" className={skillsOpen ? 'is-open' : undefined} />
                        </button>
                        : <>{segment.label}{segment.count !== undefined ? <small>{segment.count} 项</small> : null}</>}</dt>
                    <dd>{segment.deferred ? '未启用' : <>{segment.meta ? <>{segment.meta} · </> : null}{compact(segment.tokens)}{capacity ? <em>{Math.round(segment.tokens / capacity * 100)}%</em> : null}</>}</dd>
                </div>)}
                {segments.some(segment => segment.key === 'free') && <div className="agent-context-legend-row is-free">
                    <span className="agent-context-dot" data-tone="free" aria-hidden="true" />
                    <dt>空闲空间</dt>
                    <dd>{compact(segments.find(segment => segment.key === 'free')?.tokens ?? 0)}{capacity ? <em>{Math.round((segments.find(segment => segment.key === 'free')?.tokens ?? 0) / capacity * 100)}%</em> : null}</dd>
                </div>}
            </dl>
            {skills && skillsOpen && <div className="agent-context-skills" aria-label="技能与方法">
                <div className="agent-rail-row agent-rail-result">
                    <Sparkles size={15} aria-hidden="true" />
                    <span className="agent-rail-result-text"><span>技能目录</span><small>方法与技能随系统提示注入 · {runtime.skills?.listed ? `${runtime.skills.listed} 个技能 · ` : ''}{compact(runtime.skills?.sectionTokens ?? runtime.skillsTokens ?? 0)} token</small></span>
                </div>
                {skills.cards.map(card => <button key={card.id} type="button" className="agent-rail-row agent-rail-button agent-rail-result" onClick={() => onOpen?.(card.id)}>
                    {card.kind === 'skill' ? <Sparkles size={15} aria-hidden="true" /> : <BookOpen size={15} aria-hidden="true" />}
                    <span className="agent-rail-result-text"><span>{card.title}</span><small>{card.kind === 'skill' ? `技能 ${card.version}` : `版本 ${card.version}`} · {compact(card.tokens ?? 0)} token</small></span>
                </button>)}
            </div>}
            <p className="agent-context-foot">{approximate ? '数值为估算；' : ''}{working ? '随任务实时更新。' : '发送消息以刷新。'}自动压缩缓冲在接近窗口上限时启用。</p>
        </div>}
    </section>;
}
