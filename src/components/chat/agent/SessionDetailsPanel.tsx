/**
 * 右侧「会话详情」停靠栏（claude /code 会话栏）：模型 / 上下文 / 成果 / 计费。
 * 常驻显示；打开工作区（artifacts）时整栏让位隐藏。
 *
 * 'use client' 标记说明：
 * - 子卡内含展开/收起状态，随客户端会话运行数据更新
 */
'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { WorkspaceStatusCards, type WorkspaceRunInfo } from './AgentWorkspaceSections';
import { getAgentChart } from '@/lib/agent/tool-presentation';
import { getAgentChartReference } from '@/lib/agent/chart-interaction';
import type { AgentMessageData, AgentPart } from '@/lib/agent/types';
import { getChartKindMeta } from './chart-registry';

const RAIL_MIN = 240;
const RAIL_MAX = 360;
const RAIL_KEY = 'taibu.session-rail-width';
const clampWidth = (value: number) => Math.max(RAIL_MIN, Math.min(RAIL_MAX, Math.round(value)));

export function SessionDetailsPanel({ data, run, onOpen }: {
    data?: AgentMessageData; run?: WorkspaceRunInfo;
    /** 点开成果行：打开工作区并定位到对应资源。 */
    onOpen?: (id: string) => void;
}) {
    // 每种命盘只列一次（同一盘面的复查合并到第一次读取）。
    const charts = useMemo(() => {
        const tools = (data?.parts ?? []).filter((part): part is Extract<AgentPart, { type: 'tool' }> => part.type === 'tool');
        const seen = new Set<string>();
        return tools.flatMap(tool => {
            const chart = getAgentChart(tool);
            if (!chart) return [];
            const key = getAgentChartReference(tool) ?? tool.id;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{ id: tool.id, chart }];
        });
    }, [data?.parts]);
    // 会话栏可拖动（claude 右栏同构）：宽度记在本地，双击恢复 280。
    const [width, setWidth] = useState(() => {
        try { return clampWidth(Number(localStorage.getItem(RAIL_KEY)) || 280); } catch { return 280; }
    });
    const [showAll, setShowAll] = useState(false);
    const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
    const saveWidth = useCallback((value: number) => {
        const next = clampWidth(value);
        setWidth(next);
        try { localStorage.setItem(RAIL_KEY, String(next)); } catch { /* optional */ }
    }, []);
    return <aside id="agent-session-panel" className="agent-session-rail" aria-label="会话详情" style={{ width }}>
        <div className="agent-rail-resizer" role="separator" aria-orientation="vertical" aria-label="调整会话栏宽度"
            aria-valuenow={width} aria-valuemin={RAIL_MIN} aria-valuemax={RAIL_MAX} tabIndex={0}
            onDoubleClick={() => saveWidth(280)}
            onKeyDown={event => {
                if (event.key === 'ArrowLeft') { event.preventDefault(); saveWidth(width - 16); }
                if (event.key === 'ArrowRight') { event.preventDefault(); saveWidth(width + 16); }
            }}
            onPointerDown={event => {
                event.preventDefault();
                dragRef.current = { startX: event.clientX, startWidth: width };
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
                const drag = dragRef.current;
                if (drag) saveWidth(drag.startWidth + drag.startX - event.clientX);
            }}
            onPointerUp={() => { dragRef.current = null; }}
            onPointerCancel={() => { dragRef.current = null; }} />
        <WorkspaceStatusCards data={data} run={run} afterContext={charts.length > 0 ? (grip => <section className="agent-ws-status-card" aria-label="成果">
            <div className="agent-ws-status-head"><span>成果</span>{grip}</div>
            <div className="agent-rail-body">
                {(showAll ? charts : charts.slice(0, 4)).map(({ id, chart }) => {
                    const Icon = getChartKindMeta(chart.kind).icon;
                    return <button key={id} type="button" className="agent-rail-row agent-rail-button agent-rail-result" onClick={() => onOpen?.(`tool:${id}`)}>
                        <Icon size={16} aria-hidden="true" />
                        <span className="agent-rail-result-text"><span>{chart.title}</span><small>{chart.summary}</small></span>
                    </button>;
                })}
                {charts.length > 4 && <button type="button" className="agent-rail-more" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
                    {showAll ? '收起' : '显示更多'}{showAll ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                </button>}
            </div>
        </section>) : undefined} />
    </aside>;
}
