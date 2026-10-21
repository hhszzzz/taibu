import type { ToolAnnotation, ToolDefinition } from './contract.js';

/**
 * The low-frequency tools a client may leave out of each request and find by search instead: the drilldowns into a
 * chart already cast, and the calculations a first reading seldom needs. The chart tools stay offered.
 */
export const DEFERRED_TOOL_NAMES: readonly string[] = [
  'bazi_relations', 'bazi_wuxing', 'bazi_liunian_scan', 'ziwei_palace', 'qimen_palace', 'daliuren_lessons',
  'astrology_point', 'liuyao_line',
  'bazi_dayun', 'bazi_pillars_resolve', 'ziwei_horoscope', 'ziwei_flying_star', 'almanac_select',
];

const DEFERRED = new Set(DEFERRED_TOOL_NAMES);

/** How many tools a search returns unless asked otherwise, and at most. */
export const TOOL_SEARCH_LIMIT = 8;
export const TOOL_SEARCH_MAX_LIMIT = 20;

export function isDeferredTool(name: string): boolean {
  return DEFERRED.has(name);
}

/** Chinese words a model uses for each deferred tool; the tool name and description carry the rest. */
const KEYWORDS: Readonly<Record<string, string>> = {
  bazi_relations: '八字 关系 刑冲合害 合冲 刑 冲 害 破 岁运 流年 大运 叠加 干支关系',
  bazi_wuxing: '八字 五行 旺衰 强弱 得令 通根 用神 喜忌 分布',
  bazi_liunian_scan: '八字 流年 逐年 扫描 应期 年份 哪年 走势 逐年排',
  ziwei_palace: '紫微 紫微斗数 宫位 十二宫 星曜 命宫 财帛 官禄 夫妻 三方四正',
  qimen_palace: '奇门 奇门遁甲 九宫 宫 门 星 神 格局 落宫',
  daliuren_lessons: '大六壬 六壬 课 三传 四课 天地盘 贵神',
  astrology_point: '占星 星盘 行星 宫位 相位 交点 星座 黄道',
  liuyao_line: '六爻 爻 动爻 世应 变卦 本卦 卦 纳甲 六亲',
  bazi_dayun: '八字 大运 起运 运程 十年 排大运 大运流年 交运',
  bazi_pillars_resolve: '八字 四柱 干支 反推 时辰 校正 校准 柱 出生时辰',
  ziwei_horoscope: '紫微 紫微斗数 大限 流年 流月 流日 流时 运势 运程',
  ziwei_flying_star: '紫微 紫微斗数 飞星 四化 化禄 化权 化科 化忌 宫位 飞化',
  almanac_select: '黄历 择日 选日 吉日 宜忌 嫁娶 开业 动土 搬家 出行 日子',
};

const CJK = /\p{Script=Han}+/gu;
const LATIN = /[a-z0-9]+/g;

/** Query terms: Latin words of two or more characters, and overlapping CJK bigrams (a lone character stays whole). */
export function toolSearchTerms(query: string): string[] {
  const text = query.trim().toLowerCase();
  const terms = new Set(text.match(LATIN)?.filter(term => term.length > 1) ?? []);
  for (const [run] of text.matchAll(CJK)) {
    if (run.length === 1) terms.add(run);
    else for (let index = 0; index + 1 < run.length; index++) terms.add(run.slice(index, index + 2));
  }
  return [...terms];
}

/** A tool a search can find: its name and description, with its title looked up separately. */
export interface ToolSearchCandidate {
  name: string;
  description: string;
}

/**
 * Names of the best matches, best first; ties keep the candidates' order. A name match outranks a title, a title a
 * keyword, and all of them outrank the description, so "大运" finds `bazi_dayun` before a tool that merely mentions it.
 * Pi's own search ranks with BM25 over Latin tokens, where a Chinese query tokenizes to nothing.
 */
export function rankDeferredTools(query: string, candidates: readonly ToolSearchCandidate[], titles: ReadonlyMap<string, string>,
  limit = TOOL_SEARCH_LIMIT): string[] {
  const text = query.trim().toLowerCase();
  const terms = toolSearchTerms(query);
  if (!text || !terms.length) return [];
  const scored = candidates.map((candidate, index) => {
    const name = candidate.name.toLowerCase();
    const spaced = name.replaceAll('_', ' ');
    const title = (titles.get(candidate.name) ?? '').toLowerCase();
    const keywords = Object.hasOwn(KEYWORDS, candidate.name) ? KEYWORDS[candidate.name] : '';
    const description = candidate.description.toLowerCase();
    // The name, title and curated keywords say what a tool is for; its description also mentions what it is not.
    // A description-only match is a coincidence, so it never makes a tool a result on its own.
    let strong = 0, weak = 0;
    // The whole query is a stronger signal than any one term: "流年扫描" names a tool outright.
    if (text.length > 1) strong += (spaced.includes(text) ? 20 : 0) + (title.includes(text) ? 14 : 0) + (keywords.includes(text) ? 10 : 0);
    for (const term of terms) strong += (spaced.includes(term) ? 8 : 0) + (title.includes(term) ? 6 : 0) + (keywords.includes(term) ? 5 : 0);
    if (strong === 0) return { name: candidate.name, score: 0, index };
    if (text.length > 1 && description.includes(text)) weak += 4;
    for (const term of terms) if (description.includes(term)) weak += 2;
    return { name: candidate.name, score: strong + weak, index };
  }).filter(match => match.score > 0);
  return scored.sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit).map(match => match.name);
}

/**
 * Which tools an MCP server lists. `all` lists every tool. `core` lists the tools a reading starts from and reaches the
 * deferred ones through `tool_search` and `tool_call`: MCP has no deferred tools, and a tool list may not change as a
 * side effect of other requests, so the list itself stays fixed and smaller.
 */
export type ToolListMode = 'all' | 'core';

export function parseToolListMode(value: string | undefined): ToolListMode {
  if (value === undefined || value === '' || value === 'all') return 'all';
  if (value === 'core') return 'core';
  throw new Error(`工具列表模式只能是 all 或 core，收到「${value}」`);
}

export const TOOL_SEARCH_NAME = 'tool_search';
export const TOOL_CALL_NAME = 'tool_call';

const GATEWAY_ANNOTATIONS: ToolAnnotation = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** The two tools through which a `core` list reaches the deferred tools. */
export function getToolGatewayDefinitions(): ToolDefinition[] {
  return [{
    name: TOOL_SEARCH_NAME,
    title: '查找工具',
    description: '按中文关键词查找没有直接列出的低频太卜工具：八字的关系、五行、流年扫描详查，大运与四柱反推，紫微宫位、运限与飞星，择日，以及奇门、大六壬、占星、六爻的局部详查。'
      + '返回各工具的用途与参数 schema，再用 tool_call 调用。已列出的排盘工具直接调用，不必查找。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: '中文关键词或工具名，如「大运」「流年扫描」「飞星四化」「择日」「宫位」「动爻」' },
        limit: { type: 'integer', minimum: 1, maximum: TOOL_SEARCH_MAX_LIMIT, description: `最多返回几个工具，默认 ${TOOL_SEARCH_LIMIT}` },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: GATEWAY_ANNOTATIONS,
  }, {
    name: TOOL_CALL_NAME,
    title: '调用低频工具',
    description: '调用 tool_search 找到的工具：name 填工具名，arguments 按该工具的参数 schema 填写；结果与直接调用该工具相同。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: [...DEFERRED_TOOL_NAMES], description: '工具名' },
        arguments: { type: 'object', description: '按 tool_search 返回的参数 schema 填写的参数' },
      },
      required: ['name', 'arguments'],
      additionalProperties: false,
    },
    annotations: GATEWAY_ANNOTATIONS,
  }];
}

/** The deferred tools among `definitions` that best match the query, best first. */
export function searchDeferredTools<T extends ToolDefinition>(query: string, definitions: readonly T[], limit = TOOL_SEARCH_LIMIT): T[] {
  const deferred = definitions.filter(definition => isDeferredTool(definition.name));
  const titles = new Map(deferred.map(definition => [definition.name, definition.title ?? '']));
  return rankDeferredTools(query, deferred, titles, limit).map(name => deferred.find(definition => definition.name === name)!);
}

/** What a search tells the model: each match with its whole description and input schema, ready for tool_call. */
export function renderToolSearchResult(matches: readonly ToolDefinition[]): string {
  if (!matches.length) return '没有匹配的工具。换一个说法，或用工具名再试；已列出的排盘工具直接调用，不必查找。';
  return [`找到 ${matches.length} 个工具，用 tool_call 调用（name 填工具名，arguments 按参数 schema 填写）：`,
    ...matches.map(tool => `## ${tool.name}${tool.title ? `（${tool.title}）` : ''}\n\n${tool.description}\n\n参数 schema：\n\n\`\`\`json\n${JSON.stringify(tool.inputSchema)}\n\`\`\``),
  ].join('\n\n');
}

/** Server instructions: where the reading methods are, and in `core` mode how to reach the tools not listed. */
export function getServerInstructions(mode: ToolListMode): string {
  return [
    '太卜提供命理、术数与占卜计算工具。工具结果同时包含规范文本与 canonical JSON。',
    '解读结果前先用 load_analysis_method 加载对应体系的方法卡，按卡中的断法、工具流程与输出要求组织解读；用户也可以选用与方法卡同名的 prompt。',
    ...(mode === 'core' ? ['低频的详查、大运、运限、飞星与择日工具没有直接列出：用 tool_search 按中文关键词查找，再用 tool_call 调用。'] : []),
  ].join('\n');
}
