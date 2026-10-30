/**
 * 右侧「会话详情」停靠栏（claude /code 会话栏）：模型 / 上下文 / 成果 / 计费。
 * 常驻显示；打开工作区（artifacts）时整栏让位隐藏。
 *
 * 'use client' 标记说明：
 * - 子卡内含展开/收起状态，随客户端会话运行数据更新
 */
'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { WorkspaceStatusCards, type WorkspaceRunInfo } from './AgentWorkspaceSections';
import { getAgentChart, getAgentSkills } from '@/lib/agent/tool-presentation';
import { getAgentChartReference } from '@/lib/agent/chart-interaction';
import type { AgentMessageData, AgentPart } from '@/lib/agent/types';
import { getChartKindMeta } from './chart-registry';

export function SessionDetailsPanel({ data, run, onOpen }: {
    data?: AgentMessageData; run?: WorkspaceRunInfo;
    /** 点开成果行：打开工作区并定位到对应资源。 */
    onOpen?: (id: string) => void;
}) {
    // 每种命盘只列一次（同一盘面的复查合并到第一次读取）。
    const tools = useMemo(() => (data?.parts ?? []).filter((part): part is Extract<AgentPart, { type: 'tool' }> => part.type === 'tool'), [data?.parts]);
    const charts = useMemo(() => {
        const seen = new Set<string>();
        return tools.flatMap(tool => {
            const chart = getAgentChart(tool);
            if (!chart) return [];
            const key = getAgentChartReference(tool) ?? tool.id;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{ id: tool.id, chart }];
        });
    }, [tools]);
    // 技能 = 本任务用过的方法，列在上下文卡里，点开就是它的页。
    const model = data?.runtime?.model.id;
    const skills = useMemo(() => getAgentSkills(tools, model), [tools, model]);
    // 会话栏固定宽度（280px，见 .agent-session-rail）：不提供拖拽或顶部手柄。
    const [showAll, setShowAll] = useState(false);
    return <aside id="agent-session-panel" className="agent-session-rail" aria-label="会话详情">
        <WorkspaceStatusCards data={data} run={run} skills={skills} onOpen={onOpen} afterContext={charts.length > 0 ? (grip => <section className="agent-ws-status-card" aria-label="成果">
            <div className="agent-ws-status-head"><span>成果</span>{grip}</div>
            <div className="agent-rail-body">
                {(showAll ? charts : charts.slice(0, 4)).map(({ id, chart }) => {
                    const Icon = getChartKindMeta(chart.kind).icon;
                    return <Button unstyled key={id} type="button" className="agent-rail-row agent-rail-button agent-rail-result" onClick={() => onOpen?.(`tool:${id}`)}>
                        <Icon size={16} aria-hidden="true" />
                        <span className="agent-rail-result-text"><span>{chart.title}</span><small>{chart.summary}</small></span>
                    </Button>;
                })}
                {charts.length > 4 && <Button unstyled type="button" className="agent-rail-more" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
                    {showAll ? '收起' : '显示更多'}{showAll ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                </Button>}
            </div>
        </section>) : undefined} />
    </aside>;
}
