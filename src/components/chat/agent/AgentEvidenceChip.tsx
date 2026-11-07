'use client';
// 需要读取工作区上下文，在工作区打开“回答依据”

import { BookOpenCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { AgentPart } from '@/lib/agent/types';
import { AGENT_EVIDENCE_LABELS } from '@/lib/agent/evidence';
import { useAgentResultWorkspace } from './AgentResultContext';
import { getAgentEvidenceSummary } from './presentation';

/** 依据 3 · 知识库 2 · 六爻 1 · 联网 1: what this task returned to cite; the sources themselves live in the workspace. */
export function AgentEvidenceChip({ parts }: { parts: AgentPart[] }) {
    const workspace = useAgentResultWorkspace();
    const evidence = getAgentEvidenceSummary(parts);
    if (!evidence) return null;
    const text = [
        `依据 ${evidence.total}`,
        ...(evidence.knowledge ? [`${AGENT_EVIDENCE_LABELS.knowledge} ${evidence.knowledge}`] : []),
        ...evidence.charts.map(([label, count]) => `${label} ${count}`),
        ...(evidence.web ? [`${AGENT_EVIDENCE_LABELS.web} ${evidence.web}`] : []),
    ].join(' · ');
    const label = <><BookOpenCheck size={14} aria-hidden="true" /><span>{text}</span></>;
    return workspace
        ? <Button unstyled type="button" className="agent-evidence-chip" onClick={() => workspace.openResource('evidence')}>{label}</Button>
        : <p className="agent-evidence-chip">{label}</p>;
}
