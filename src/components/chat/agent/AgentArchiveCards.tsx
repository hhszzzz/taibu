'use client';
// 需要保存状态查询、点击保存的进行中状态与 Toast

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkCheck, BookmarkPlus, CircleAlert } from 'lucide-react';
import { agentJson } from '@/lib/agent/browser-client';
import {
    AGENT_ARCHIVE_KIND_LABELS, describeMasterReviewFill, getAgentArchiveHref,
    type AgentArchiveCard, type AgentArchiveRecord, type AgentArchiveStatus,
} from '@/lib/agent/archive';
import { queryKeys } from '@/lib/query/keys';
import { useToast } from '@/components/ui/Toast';
import './agent-results.css';

const archiveUrl = (runId: string) => `/api/agent/runs/${encodeURIComponent(runId)}/archive`;

/** Where a proposal would be written, as the user finds it afterwards. */
function describeTarget(card: AgentArchiveCard): string {
    const { proposal } = card;
    if (proposal.kind === 'master_review') return `${proposal.chart.label} · 断事笔记`;
    if (proposal.kind === 'event' && proposal.chart?.type === 'bazi_chart') return `${proposal.chart.label} · 断事笔记`;
    return proposal.chart ? `命理记录 · 关联${proposal.chart.label}` : '命理记录';
}

function ProposalBody({ card }: { card: AgentArchiveCard }) {
    const { proposal } = card;
    if (proposal.kind === 'master_review') return <ul className="agent-archive-lines">
        {describeMasterReviewFill(proposal.review).map(line => <li key={line}>{line}</li>)}
    </ul>;
    if (proposal.kind === 'event') return <>
        <p className="agent-archive-title">{proposal.date} · {proposal.category} · {proposal.title}</p>
        {proposal.detail && <p className="agent-archive-detail">{proposal.detail}</p>}
    </>;
    return <>
        <p className="agent-archive-title">{proposal.title}{proposal.category === 'prediction' ? ` · 待验证${proposal.date ? `（${proposal.date}）` : ''}` : proposal.date ? ` · ${proposal.date}` : ''}</p>
        <p className="agent-archive-detail">{proposal.content}</p>
        {proposal.tags.length > 0 && <p className="agent-archive-tags">{proposal.tags.map(tag => <span key={tag}>{tag}</span>)}</p>}
    </>;
}

/**
 * 保存卡片：Agent 的判断或结论，用户点「保存」才写入档案。状态每次从现有档案读出：删掉保存的内容后又可保存，
 * 命理师判断已被填写时只提示、不覆盖。
 */
export function AgentArchiveProposalCard({ card }: { card: AgentArchiveCard }) {
    const queryClient = useQueryClient();
    const { showToast } = useToast();
    const key = queryKeys.agentArchive(card.runId, card.callId);
    const status = useQuery({
        queryKey: key,
        queryFn: ({ signal }) => agentJson<AgentArchiveStatus>(`${archiveUrl(card.runId)}?callId=${encodeURIComponent(card.callId)}`, { signal }),
        staleTime: 30_000,
    });
    const [saving, setSaving] = useState(false);
    const save = async () => {
        setSaving(true);
        try {
            const next = await agentJson<AgentArchiveStatus>(archiveUrl(card.runId), {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callId: card.callId }),
            });
            queryClient.setQueryData(key, next);
            if (next.state === 'saved') showToast('success', '已保存到档案');
            else if (next.state === 'filled') showToast('info', '这些项已经填写，没有改动');
            else if (next.state === 'unavailable') showToast('error', next.message);
        } catch (error) {
            showToast('error', error instanceof Error ? error.message : '保存失败');
        } finally {
            setSaving(false);
        }
    };
    const state = status.data;
    const kind = AGENT_ARCHIVE_KIND_LABELS[card.proposal.kind];
    return <section className="agent-archive-card" data-state={state?.state ?? 'loading'} aria-label={`${kind}：${describeTarget(card)}`}>
        <header><span className="agent-archive-kind">{kind}</span><span className="agent-archive-where">{describeTarget(card)}</span></header>
        <ProposalBody card={card} />
        {card.proposal.kind === 'master_review' && <p className="agent-archive-note">只补填尚未填写的项，你已填写的判断不会被覆盖。</p>}
        <footer>
            {state?.state === 'saved'
                ? state.href
                    ? <Link className="agent-archive-action is-saved" href={state.href}><BookmarkCheck size={14} aria-hidden="true" />已保存 · 查看</Link>
                    : <span className="agent-archive-action is-saved"><BookmarkCheck size={14} aria-hidden="true" />已保存</span>
                : state?.state === 'filled'
                    ? <span className="agent-archive-status">这些项已经填写{state.href && <> · <Link href={state.href}>查看断事笔记</Link></>}</span>
                    : state?.state === 'unavailable'
                        ? <span className="agent-archive-status" role="note"><CircleAlert size={14} aria-hidden="true" />{state.message}</span>
                        : <button type="button" className="agent-archive-action" disabled={saving || status.isPending} onClick={() => void save()}>
                            <BookmarkPlus size={14} aria-hidden="true" />{saving ? '正在保存' : '保存'}
                        </button>}
            {status.isError && !state && <span className="agent-archive-status" role="alert">暂时读不到保存状态，仍可保存</span>}
        </footer>
    </section>;
}

/** 已记入档案：record_user_event 按用户原话写下的事件。 */
export function AgentArchiveReceipt({ record }: { record: AgentArchiveRecord }) {
    const href = getAgentArchiveHref(record.target, record.id, record.chart);
    const where = record.target === 'case_event' && record.chart ? `${record.chart.label}的断事笔记` : '命理记录';
    return <p className="agent-archive-receipt">
        <BookmarkCheck size={14} aria-hidden="true" />
        <span>已按你的原话记入{where}：{record.date} · {record.category} · {record.title}</span>
        {href && <Link href={href}>查看</Link>}
    </p>;
}
