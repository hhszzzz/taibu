'use client';
// 需要折叠状态与点击交互；定位消息时同步展开所在的一轮

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ChatMessage } from '@/types';
import { formatAgentElapsed } from './AgentHeaderStatus';
import { agentStatusLabels, getAgentRoundFolds, type AgentRoundFold, type AgentRoundSummary } from './presentation';

/** What the transcript lists need to fold earlier rounds. */
export interface AgentRoundFolding {
    folds: ReadonlyMap<string, AgentRoundFold>;
    /** Rounds the reader unfolded, by run id. */
    unfolded: ReadonlySet<string>;
    onToggle: (roundId: string) => void;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Fold state of one conversation's earlier Agent rounds. `reveal` unfolds the
 * round holding a message before a jump to it (minimap, search, links), and
 * does so synchronously so the jump finds the message on the page.
 */
export function useAgentRoundFolds(messages: readonly ChatMessage[], scope: string) {
    const folds = useMemo(() => getAgentRoundFolds(messages), [messages]);
    const [state, setState] = useState<{ scope: string; ids: ReadonlySet<string> }>({ scope, ids: NONE });
    const unfolded = state.scope === scope ? state.ids : NONE;
    const onToggle = useCallback((roundId: string) => setState(previous => {
        const ids = new Set(previous.scope === scope ? previous.ids : NONE);
        if (!ids.delete(roundId)) ids.add(roundId);
        return { scope, ids };
    }), [scope]);
    const reveal = useCallback((messageId: string) => {
        const roundId = folds.get(messageId)?.round.id;
        if (!roundId || unfolded.has(roundId)) return;
        flushSync(() => setState(previous => ({ scope, ids: new Set([...(previous.scope === scope ? previous.ids : NONE), roundId]) })));
    }, [folds, unfolded, scope]);
    const rounds = useMemo<AgentRoundFolding>(() => ({ folds, unfolded, onToggle }), [folds, unfolded, onToggle]);
    return { rounds, reveal };
}

/** A row inside a folded round that does not carry the bar shows nothing. */
export function isFoldedAway(rounds: AgentRoundFolding | undefined, messageId: string): boolean {
    const fold = rounds?.folds.get(messageId);
    return Boolean(fold && !fold.first && !rounds?.unfolded.has(fold.round.id));
}

function describeRound(round: AgentRoundSummary): string {
    return [
        round.label,
        round.question,
        round.steps ? `${round.steps} 个步骤` : null,
        round.durationMs === null ? null : formatAgentElapsed(round.durationMs),
        round.status === 'completed' ? null : agentStatusLabels[round.status],
    ].filter(Boolean).join(' · ');
}

/** 上一轮 bar (AgentResearch board): an ended earlier round on one line, unfolding in place. */
export function AgentRoundBar({ round, open, onToggle }: { round: AgentRoundSummary; open: boolean; onToggle: (roundId: string) => void }) {
    return (
        <button type="button" className="agent-round-fold" aria-expanded={open} data-status={round.status} onClick={() => onToggle(round.id)}>
            {open ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
            <span className="agent-round-fold-text">{describeRound(round)}</span>
            {round.results > 0 && <span className="agent-round-fold-results">已选定 {round.results} 份成果</span>}
        </button>
    );
}

/** One transcript row: the round's bar on its first row, then the message unless the round is folded. */
export function AgentRoundRow({ rounds, messageId, children }: { rounds?: AgentRoundFolding; messageId: string; children: ReactNode }) {
    const fold = rounds?.folds.get(messageId);
    if (!rounds || !fold) return children;
    const open = rounds.unfolded.has(fold.round.id);
    return <>
        {fold.first && <AgentRoundBar round={fold.round} open={open} onToggle={rounds.onToggle} />}
        {open && children}
    </>;
}
