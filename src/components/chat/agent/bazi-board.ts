/**
 * 八字盘面的详查数据：从关系 / 五行详查的工具结果里取出 Core 的规范 JSON，
 * 并判断 Agent 最近在这张盘上看的是干支关系还是五行流通。只读工具结果，不重新计算。
 */
import type { BaziRelationsCanonicalJSON, BaziWuxingCanonicalJSON } from 'taibu-core/bazi';
import type { AgentToolPart } from '@/lib/agent/tool-presentation';
import { getChartFocus } from '@/lib/agent/chart-interaction';
import { relationMode, relationTone, type RelationMode } from '@/lib/divination/ganzhi-relation-layout';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isRecord = (value: Json | undefined): value is { [key: string]: Json } => !!value && typeof value === 'object' && !Array.isArray(value);
const isRelationList = (value: Json | undefined) => Array.isArray(value) && value.every(row => isRecord(row) && typeof row.类型 === 'string' && Array.isArray(row.位置));

export function asBaziRelations(result: Json): BaziRelationsCanonicalJSON | null {
    if (!isRecord(result) || !Array.isArray(result.参与柱位) || !isRelationList(result.原局关系)) return null;
    if (result.叠加关系 !== undefined && !isRelationList(result.叠加关系)) return null;
    return result.参与柱位.every(item => isRecord(item) && typeof item.柱 === 'string' && typeof item.干支 === 'string')
        ? result as unknown as BaziRelationsCanonicalJSON : null;
}

export function asBaziWuxing(result: Json): BaziWuxingCanonicalJSON | null {
    if (!isRecord(result) || !Array.isArray(result.五行统计) || !isRecord(result.月令) || !isRecord(result.日主) || !isRecord(result.相生链)) return null;
    return ['通根', '透干', '干支自坐', '相邻天干'].every(key => isRelationList(result[key])) ? result as unknown as BaziWuxingCanonicalJSON : null;
}

function latestResult<T>(tools: readonly AgentToolPart[], name: string, parse: (result: Json) => T | null): T | null {
    for (const tool of [...tools].reverse()) {
        if (tool.name !== name || tool.status !== 'completed') continue;
        const output = tool.output && typeof tool.output === 'object' ? tool.output as { result?: Json } : {};
        const parsed = parse(output.result ?? null);
        if (parsed) return parsed;
    }
    return null;
}

/** Agent 在这张八字上最近看的是干支关系还是五行流通：盘面跟随时切到对应的连线模式。 */
export type BaziViewing = { key: string; mode: RelationMode; label: string };

const VIEWING_DRILLDOWNS: Record<string, Omit<BaziViewing, 'key'>> = {
    bazi_relations: { mode: 'relations', label: '干支关系' },
    bazi_wuxing: { mode: 'flow', label: '五行流通' },
};

/**
 * 取最近一次关系 / 五行详查，或最近一次落在干支关系上的定位（focus_chart）。
 * `pinned` 是读者从步骤或引用打开的那一步：它决定当时看的是什么。
 */
export function getBaziViewing(tools: readonly AgentToolPart[], reference: string | null, relations: ReadonlyArray<{ id: string; 类型: string; 位置: unknown[] }>, pinned?: AgentToolPart): BaziViewing | null {
    const viewingOf = (tool: AgentToolPart): BaziViewing | null => {
        const drilldown = VIEWING_DRILLDOWNS[tool.name];
        if (drilldown) return { key: tool.id, ...drilldown };
        const focus = getChartFocus(tool);
        if (!focus || focus.reference !== reference) return null;
        const located = relations.filter(relation => focus.targetIds.includes(relation.id));
        if (!located.length) return null;
        const mode = relationMode(relationTone(located[0].类型, located[0].位置.length).tone);
        return { key: tool.id, mode, label: mode === 'flow' ? '五行流通' : '干支关系' };
    };
    if (pinned) return viewingOf(pinned);
    for (const tool of [...tools].reverse()) {
        if (tool.name === 'focus_chart' && getChartFocus(tool)?.reference === reference) return viewingOf(tool);
        const viewing = VIEWING_DRILLDOWNS[tool.name] ? viewingOf(tool) : null;
        if (viewing) return viewing;
    }
    return null;
}

/** 一张八字最近一次完成的关系详查与五行详查；盘面据此补画原局关系、通根与自坐。 */
export function getLatestBaziFacts(tools: readonly AgentToolPart[]) {
    return { relations: latestResult(tools, 'bazi_relations', asBaziRelations), wuxing: latestResult(tools, 'bazi_wuxing', asBaziWuxing) };
}
