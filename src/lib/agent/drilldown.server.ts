import 'server-only';
import { buildToolSuccessPayload, executeTool, type ToolInputSchema, type ToolSchema } from 'taibu-core/mcp';
import { buildBaziInputFromStoredFields } from '@/lib/divination/bazi-record';
import { getProvider } from '@/lib/data-sources';
import type { AgentRunRow, AgentStore } from './store.server';
import { loadAgentChart } from './chart-tools.server';
import { CHART_SOURCE_KINDS, getDrilldownTargets, parseChartReference } from './chart-interaction';
import { AGENT_CHART_NAMES, getAgentDrilldownBase, type AgentChartKind } from './tool-catalog';
import type { DomainToolResult } from './types';

/**
 * 详查工具的 Agent 入口：模型只传命盘引用与查询参数，出生或起卦参数从
 * 本会话成果的原始参数、或用户已存记录重建，再交给 Core 的同名工具计算。
 */
export function drilldownParameters(selector: ToolInputSchema): ToolInputSchema {
  const reference: ToolSchema = {
    type: 'string', minLength: 1, maxLength: 64,
    description: '要详查的命盘：artifact:成果ID，或 read_user_data 返回的 chartReference',
  };
  return {
    type: 'object',
    properties: { reference, ...selector.properties },
    required: ['reference', ...(selector.required ?? [])],
    ...(selector.allOf ? { allOf: selector.allOf } : {}),
    additionalProperties: false,
  };
}

/** 盘面身份：重算结果与成果快照不一致时，说明算法或时间口径已变，不能冒充原盘。 */
const CHART_IDENTITY: Partial<Record<AgentChartKind, (chart: Record<string, unknown>) => string>> = {
  bazi: chart => JSON.stringify(Array.isArray(chart.四柱) ? (chart.四柱 as Array<{ 柱?: unknown; 干支?: unknown }>).map(pillar => `${pillar.柱}${pillar.干支}`) : null),
};

const definedOnly = (input: object) => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

/** The base tool's input for a chart reference; ownership was checked by loadAgentChart. */
async function baseInputOf(store: AgentStore, run: AgentRunRow, reference: string, base: AgentChartKind): Promise<Record<string, unknown>> {
  const parsed = parseChartReference(reference)!;
  if (parsed.source === 'artifact') {
    const artifact = await store.chartArtifact(run, parsed.id);
    if (!artifact || artifact.tool_name !== base) throw new Error(`该详查工具只适用于${AGENT_CHART_NAMES[base]}`);
    const { detailLevel: _detailLevel, ...args } = artifact.args;
    return args;
  }
  if (CHART_SOURCE_KINDS[parsed.source] !== base) throw new Error(`该详查工具只适用于${AGENT_CHART_NAMES[base]}`);
  const provider = await getProvider(parsed.source);
  const row = await provider.get(parsed.id, run.user_id, { client: store.db }) as Record<string, unknown> | null;
  if (!row) throw new Error('命盘不存在或无权访问');
  if (parsed.source === 'bazi_chart') return definedOnly(buildBaziInputFromStoredFields(row));
  throw new Error('这张命盘暂不支持详查，请先重新排盘');
}

export interface DrilldownToolResult extends DomainToolResult {
  /** The chart this drilldown read, so focus_chart can follow it without another inspect_chart. */
  inspection: { chartReference: string; chartKind: AgentChartKind; result: unknown };
}

export async function executeDrilldown(
  store: AgentStore, run: AgentRunRow, name: string, args: Record<string, unknown>,
): Promise<DrilldownToolResult> {
  const base = getAgentDrilldownBase(name);
  if (!base) throw new Error(`未知详查工具: ${name}`);
  const { reference: rawReference, ...selection } = args;
  const { reference, value } = await loadAgentChart(store, run, String(rawReference));
  if (value.kind !== base) throw new Error(`该详查工具只适用于${AGENT_CHART_NAMES[base]}`);
  const baseInput = await baseInputOf(store, run, reference, base);
  const identity = CHART_IDENTITY[base];
  if (identity && reference.startsWith('artifact:')) {
    const recomputed = buildToolSuccessPayload(base, await executeTool(base, baseInput)).structuredContent as Record<string, unknown>;
    if (identity(recomputed) !== identity(value.chart as unknown as Record<string, unknown>)) {
      throw new Error('命盘算法已更新或时间无法还原，请重新排盘后再详查');
    }
  }
  const rendered = buildToolSuccessPayload(name, await executeTool(name, { ...baseInput, ...selection }));
  const targets = getDrilldownTargets(value, rendered.structuredContent).map(({ id, label }) => ({ id, label }));
  const text = rendered.content.map(part => part.text).join('\n');
  return {
    content: [{ type: 'text', text }, { type: 'text', text: JSON.stringify({ reference, targets }) }],
    details: { chartReference: reference, chartKind: base, selection, result: rendered.structuredContent, targets },
    canonicalText: text,
    inspection: { chartReference: reference, chartKind: base, result: value.chart },
  };
}
