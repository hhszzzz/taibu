'use client';
// 需要渲染懒加载的交互盘面与工具详情（含复制状态）

import type { AgentToolPart } from '@/lib/agent/tool-presentation';
import { getAgentChart, getAgentToolArtifactId } from '@/lib/agent/tool-presentation';
import { getAgentChartReference, getChartResources, getLatestChartFocus, type ChartFocus } from '@/lib/agent/chart-interaction';
import type { AgentArtifact } from './presentation';
import { AgentArtifactCard } from './AgentArtifactCard';
import { AgentToolCard } from './AgentToolCard';
import { AgentInteractiveChart } from './AgentInteractiveChart';

/** Saved resource tabs use the original persisted tool result, including after refresh. */
export function AgentChartPreview({ artifact, tools, focus, followModel = false, onManual = () => {}, onAsk }: {
    artifact: AgentArtifact; tools: AgentToolPart[]; focus?: ChartFocus | null; followModel?: boolean;
    onManual?: () => void; onAsk?: (text: string) => void;
}) {
    const original = tools.find(tool => tool.status === 'completed' && getAgentToolArtifactId(tool) === artifact.id);
    const reference = original ? getAgentChartReference(original) : null;
    const resource = reference ? getChartResources(tools).find(resource => resource.reference === reference) : undefined;
    const tool = resource?.tool ?? original;
    const value = resource?.value ?? (tool && getAgentChart(tool));
    if (tool && value) return <AgentInteractiveChart value={value} tool={tool} reference={reference} focus={reference ? getLatestChartFocus(tools, reference) : focus} followModel={followModel} onManual={onManual} onAsk={onAsk} />;
    if (tool) return <AgentToolCard tool={tool} runStatus="completed" />;
    return <div className="space-y-3">
        <p className="text-sm text-foreground-secondary">此历史成果未附完整工具结果，请通过保存记录查看。</p>
        <AgentArtifactCard artifact={artifact} />
    </div>;
}
