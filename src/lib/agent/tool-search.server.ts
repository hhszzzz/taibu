import 'server-only';
import { Type } from '@earendil-works/pi-ai';
import type { Extension, PromptSection } from '@earendil-works/pi-durable';
import { defineTool } from '@earendil-works/pi-durable';
import { AGENT_CODEMODE_TOOL, AGENT_TOOL_SEARCH_TOOL, getAgentExtensionToolTitle } from './tool-catalog';

/**
 * Deferred tools are the low-frequency Taibu tools and the external MCP tools: offered only once the model asks for
 * them, so a request carries the tools a reading needs instead of every tool that exists. Pi's own `tool_search` ranks
 * with BM25 over Latin tokens; a Chinese query there tokenizes to nothing, so Taibu ranks by the Chinese titles and
 * keywords a model actually types.
 */
export const AGENT_TOOL_SEARCH_LIMIT = 8;
const MAX_LIMIT = 20;

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

/** A tool a search can find: what the registry offers and the Taibu title a model would use for it. */
export interface DeferredCandidate { name: string; description: string }

/**
 * Names of the best matches, best first; ties keep registry order. A name match outranks a title, a title a keyword,
 * and all of them outrank the description, so "大运" finds `bazi_dayun` before a tool that merely mentions it.
 */
export function rankDeferredTools(query: string, candidates: readonly DeferredCandidate[], titles: ReadonlyMap<string, string>,
  limit = AGENT_TOOL_SEARCH_LIMIT): string[] {
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

/** What a search tells the model: the tools it may now call, each with the title and first line of its description. */
function loadedText(loaded: readonly string[], candidates: readonly DeferredCandidate[], titles: ReadonlyMap<string, string>) {
  const lines = loaded.map(name => {
    const title = titles.get(name) ?? getAgentExtensionToolTitle(name);
    const summary = candidates.find(candidate => candidate.name === name)?.description.trim().split(/\r?\n/u)[0] ?? '';
    return `- ${name}${title && title !== name ? `（${title}）` : ''}${summary ? `：${summary.slice(0, 160)}` : ''}`;
  });
  return `已加载 ${loaded.length} 个工具，从下一次模型调用起可用：\n${lines.join('\n')}`;
}

const toolSearchSection: PromptSection = {
  key: 'taibu_tool_search',
  render: input => {
    const deferred = input.agent.deferred;
    if (!deferred.length) return undefined;
    return [
      `还有 ${deferred.length} 个低频工具没有直接提供：八字的关系、五行、流年扫描详查，大运与四柱反推，紫微大限与飞星，择日，奇门／大六壬／占星／六爻的局部详查，以及外部 MCP 工具。`,
      '需要其中某个工具时，先调用 tool_search 用中文关键词检索（例如「大运」「流年扫描」「飞星四化」「择日」「宫位」「六爻动爻」「档案」）。命中的工具从下一次模型调用起可用；同一对话内加载过的工具保持可用，压缩上下文后仍可用。已直接提供的排盘工具不必检索。',
      ...(input.agent.tools.some(tool => tool.name === AGENT_CODEMODE_TOOL)
        ? ['代码模式脚本可以直接调用全部工具（包括尚未加载的），不必先检索。']
        : []),
    ].join('\n');
  },
};

/** The `tool_search` tool and its guidance; the tools it loads are the ones the registry marks deferred. */
export function createAgentToolSearchExtension(titles: ReadonlyMap<string, string>): Extension {
  return {
    name: 'taibu_tool_search',
    tools: [defineTool({
      name: AGENT_TOOL_SEARCH_TOOL,
      description: '按中文关键词检索本任务尚未提供的低频工具（详查、大运、流年扫描、飞星、择日、MCP 等），命中后从下一次模型调用起可用。',
      parameters: Type.Object({
        query: Type.String({ minLength: 1, description: '中文关键词，如「大运」「流年扫描」「飞星四化」「择日」「宫位」' }),
        limit: Type.Optional(Type.Number({ description: `最多返回几个工具，默认 ${AGENT_TOOL_SEARCH_LIMIT}，最多 ${MAX_LIMIT}` })),
      }),
      // Loading changes what the model is offered; a script has its own searchTools().
      callers: ['model'],
      replay: 'safe',
      execute: async ({ query, limit }, api, context) => {
        const requested = limit ?? AGENT_TOOL_SEARCH_LIMIT;
        if (!Number.isInteger(requested) || requested <= 0 || requested > MAX_LIMIT)
          throw new Error(`limit 必须是 1–${MAX_LIMIT} 的整数`);        const candidates = (await api.agent(context)).deferred.map(tool => ({ name: tool.name, description: tool.description }));
        const loaded = rankDeferredTools(query, candidates, titles, requested);
        return {
          output: [{ type: 'text' as const, text: loaded.length ? loadedText(loaded, candidates, titles)
            : '没有匹配的工具。换一个说法，或用工具名再试；常见排盘工具已直接提供，不必检索。' }],
          details: { loaded },
          ...(loaded.length ? { control: { addTools: loaded } } : {}),
        };
      },
    })],
    sections: [toolSearchSection],
  };
}
