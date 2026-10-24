import 'server-only';
import { systemDb } from '@/lib/db/context.server';
import { buildToolSuccessPayload, executeTool, listToolDefinitions, normalizeTransportDetailLevel, type ToolInputSchema, type ToolSchema } from 'taibu-core/mcp';
import { buildBaziInputFromStoredFields } from '@/lib/divination/bazi-record';
import { getProvider } from '@/lib/data-sources';
import { qimenInputFromRecord } from '@/lib/data-sources/qimen';
import { resolveBirthTimeOptions } from '@/lib/divination/birth-time';
import type { AgentRunRow, AgentStore } from './store.server';
import { loadAgentChart } from './chart-tools.server';
import { stableAgentSeed } from './tools.server';
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
    description: '要详查的命盘：artifact:成果ID，或 read_user_data 返回的命盘引用',
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
  ziwei: chart => JSON.stringify(Array.isArray(chart.十二宫位) ? (chart.十二宫位 as Array<{ 宫位?: unknown; 干支?: unknown }>).map(palace => `${palace.宫位}${palace.干支}`) : null),
  qimen: chart => JSON.stringify(Array.isArray(chart.九宫盘)
    ? (chart.九宫盘 as Array<Record<string, unknown>>).map(row => [row.宫位序号, row.天盘天干, row.地盘天干, row.九星, row.八门, row.八神].join(':')) : null),
  daliuren: chart => JSON.stringify([
    (chart.四课 as Array<Record<string, unknown>> | undefined)?.map(row => `${row.上神}${row.下神}${row.乘将}`) ?? null,
    (chart.三传 as Array<Record<string, unknown>> | undefined)?.map(row => `${row.地支}${row.天将}`) ?? null,
  ]),
  // 六爻盘有两种形状：getAgentChart 解析后的成果快照是扁平「六爻」行，Core canonical JSON 是
  // 「六爻全盘.爻列表」的嵌套行，指纹统一取「爻位+纳甲+六亲+世应」。
  liuyao: chart => {
    const rows = (Array.isArray(chart.六爻)
      ? chart.六爻
      : (chart.六爻全盘 as { 爻列表?: unknown } | undefined)?.爻列表) as Array<Record<string, unknown>> | undefined;
    return JSON.stringify([
      (chart.卦盘 as { 本卦?: { 卦名?: unknown } } | undefined)?.本卦?.卦名 ?? null,
      (chart.卦盘 as { 变卦?: { 卦名?: unknown } } | undefined)?.变卦?.卦名 ?? null,
      Array.isArray(rows)
        ? rows.map(row => {
          const base = (row.本爻 as Record<string, unknown> | undefined) ?? row;
          return `${row.爻位}${base.纳甲}${base.六亲}${row.世应 ?? ''}`;
        })
        : null,
    ]);
  },
  astrology: chart => JSON.stringify(Array.isArray(chart.本命主星)
    ? (chart.本命主星 as Array<{ 因素?: unknown; 星座?: unknown; 黄经?: unknown }>).map(planet => `${planet.因素}${planet.星座}${planet.黄经}`) : null),
};

const definedOnly = (input: object) => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

/** 与 loadAgentChart 的紫微重建同源：出生字段加时区与夏令时选项，交给 Core 的 ziwei 工具重算。 */
function ziweiInputFromStoredFields(row: Record<string, unknown>): Record<string, unknown> {
  const birthDate = typeof row.birth_date === 'string' ? row.birth_date : '';
  const birthTime = typeof row.birth_time === 'string' ? row.birth_time : '';
  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number);
  const [birthHour, birthMinute] = birthTime.split(':').map(Number);
  if (![birthYear, birthMonth, birthDay, birthHour].every(value => Number.isInteger(value))) {
    throw new Error('出生时间字段不完整，无法重算命盘，请查看原记录');
  }
  return definedOnly({
    gender: row.gender === 'female' ? 'female' : 'male',
    birthYear, birthMonth, birthDay, birthHour,
    birthMinute: Number.isInteger(birthMinute) ? birthMinute : undefined,
    calendarType: row.calendar_type === 'lunar' ? 'lunar' : 'solar',
    isLeapMonth: row.is_leap_month === true,
    longitude: typeof row.longitude === 'number' ? row.longitude : undefined,
    ...resolveBirthTimeOptions(row),
  });
}

/** 与 loadAgentChart 的六爻重建同源：由卦码与动爻还原摇卦值，交给 Core 的 liuyao 工具重算。 */
function liuyaoInputFromStoredRow(row: Record<string, unknown>): Record<string, unknown> {
  const code = typeof row.hexagram_code === 'string' ? row.hexagram_code : '';
  const question = typeof row.question === 'string' ? row.question.trim() : '';
  const targets = Array.isArray(row.yongshen_targets)
    ? row.yongshen_targets.filter((item): item is '父母' | '兄弟' | '子孙' | '妻财' | '官鬼' => typeof item === 'string' && ['父母', '兄弟', '子孙', '妻财', '官鬼'].includes(item))
    : [];
  if (!/^[01]{6}$/.test(code) || !question || !targets.length) throw new Error('已存结果不完整，无法恢复交互盘面，请查看原记录');
  const changed = Array.isArray(row.changed_lines)
    ? row.changed_lines.filter((line): line is number => typeof line === 'number' && Number.isInteger(line) && line >= 1 && line <= 6)
    : [];
  const yaoValues = code.split('').map((value, index) => value === '1' ? (changed.includes(index + 1) ? 9 : 7) : (changed.includes(index + 1) ? 6 : 8));
  return { method: 'coins', yaoValues, question, yongShenTargets: targets, date: String(row.created_at) };
}

/** 成果里固定下来的时刻字段；模型省略起局参数时用它补回，保证详查与所看盘面同一时刻。 */
function findNestedString(value: unknown, key: string, depth = 0): string | undefined {
  if (depth > 6 || !value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedString(item, key, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const node = value as Record<string, unknown>;
  if (typeof node[key] === 'string' && node[key]) return node[key] as string;
  for (const child of Object.values(node)) {
    const found = findNestedString(child, key, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** The base tool's input for a chart reference; ownership was checked by loadAgentChart. */
async function baseInputOf(store: AgentStore, run: AgentRunRow, reference: string, base: AgentChartKind): Promise<Record<string, unknown>> {
  const parsed = parseChartReference(reference)!;
  if (parsed.source === 'artifact') {
    const artifact = await store.chartArtifact(run, parsed.id);
    if (!artifact || artifact.tool_name !== base) throw new Error(`该详查工具只适用于${AGENT_CHART_NAMES[base]}`);
    const { detailLevel: _detailLevel, ...args } = artifact.args;
    // 与工具包装一致：随机类基础工具（如六爻摇卦）用同一次调用的稳定种子重算，保证盘面可复现。
    const definition = listToolDefinitions().find(item => item.name === base);
    if (definition?.inputSchema.properties?.seed && args.seed == null) args.seed = String(stableAgentSeed(run.id, artifact.call_id));
    return args;
  }
  if (CHART_SOURCE_KINDS[parsed.source] !== base) throw new Error(`该详查工具只适用于${AGENT_CHART_NAMES[base]}`);
  const provider = await getProvider(parsed.source);
  const row = await provider.get(parsed.id, run.user_id, { db: systemDb() }) as Record<string, unknown> | null;
  if (!row) throw new Error('命盘不存在或无权访问');
  if (parsed.source === 'bazi_chart') return definedOnly(buildBaziInputFromStoredFields(row));
  if (parsed.source === 'ziwei_chart') return ziweiInputFromStoredFields(row);
  if (parsed.source === 'qimen_chart') return { ...qimenInputFromRecord(row as Parameters<typeof qimenInputFromRecord>[0]) };
  if (parsed.source === 'liuyao_divination') return liuyaoInputFromStoredRow(row);
  throw new Error('这张命盘暂不支持详查，请先重新排盘');
}

export interface DrilldownToolResult extends DomainToolResult {
  /** The chart this drilldown read, so focus_chart can follow it without another inspect_chart. */
  inspection: { chartReference: string; chartKind: AgentChartKind; result: unknown };
}

/**
 * The chart a reference names and the input its base tool recomputes it from: the artifact's own arguments or the
 * saved record's birth or casting fields. An artifact is recomputed and must still be the chart the reference shows.
 */
export async function chartInputOf(
  store: AgentStore, run: AgentRunRow, rawReference: unknown, base: AgentChartKind, mismatch = `该详查工具只适用于${AGENT_CHART_NAMES[base]}`,
) {
  const { reference, value } = await loadAgentChart(store, run, String(rawReference));
  if (value.kind !== base) throw new Error(mismatch);
  const input = await baseInputOf(store, run, reference, base);
  // 占星成果把流运时刻固定在盘面上；模型省略时补回，保证详查与所看盘面同一时刻。
  if (base === 'astrology' && reference.startsWith('artifact:') && input.transitDateTime === undefined) {
    const transit = findNestedString(value.chart, '流运时刻');
    if (transit) input.transitDateTime = transit;
  }
  const identity = CHART_IDENTITY[base];
  if (identity && reference.startsWith('artifact:')) {
    // 与 tools.server 的成果快照同档重算：快照存 full（占星近似模式为 more），
    // 默认档重算会缺少部分字段，造成与快照的无谓差异。
    const recomputedRaw = await executeTool(base, input);
    const snapshotLevel = base === 'astrology' && (recomputedRaw as { chartMeta?: { calculationMode?: string } }).chartMeta?.calculationMode === 'approximate' ? 'more' : 'full';
    const recomputed = buildToolSuccessPayload(base, recomputedRaw, { detailLevel: snapshotLevel }).structuredContent as Record<string, unknown>;
    if (identity(recomputed) !== identity(value.chart as unknown as Record<string, unknown>)) {
      throw new Error('命盘算法已更新或时间无法还原，请重新排盘后再详查');
    }
  }
  return { reference, value, input };
}

export async function executeDrilldown(
  store: AgentStore, run: AgentRunRow, name: string, args: Record<string, unknown>,
): Promise<DrilldownToolResult> {
  const base = getAgentDrilldownBase(name);
  if (!base) throw new Error(`未知详查工具: ${name}`);
  const { reference: rawReference, ...selection } = args;
  const { reference, value, input: baseInput } = await chartInputOf(store, run, rawReference, base);
  // detailLevel 只决定给模型的文本是否附口径；Core 计算时会把它剥掉
  const rendered = buildToolSuccessPayload(name, await executeTool(name, { ...baseInput, ...selection }),
    { detailLevel: normalizeTransportDetailLevel(selection.detailLevel) });
  // 所查位置由工作区自动标出，不再把引用与定位目标回给模型；模型只读 Core 的规范文本。
  const targets = getDrilldownTargets(value, rendered.structuredContent).map(({ id, label }) => ({ id, label }));
  const text = rendered.content.map(part => part.text).join('\n');
  return {
    content: [{ type: 'text', text }],
    details: { chartReference: reference, chartKind: base, selection, result: rendered.structuredContent, targets },
    canonicalText: text,
    inspection: { chartReference: reference, chartKind: base, result: value.chart },
  };
}
