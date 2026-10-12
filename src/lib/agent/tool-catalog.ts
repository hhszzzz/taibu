/**
 * Browser-safe identity of Agent tools. Execution, permissions and caching stay
 * in tools.server.ts; the durable projection and the chat UI classify tool names
 * only through this module, so a new chart or tool cannot be added to one
 * hand-written list and silently missed by another.
 */
export const AGENT_CHART_NAMES = {
  bazi: '八字命盘', ziwei: '紫微命盘', qimen: '奇门九宫盘', liuyao: '六爻卦盘',
  meihua: '梅花卦盘', daliuren: '大六壬天地盘', xiaoliuren: '小六壬课盘', tarot: '塔罗牌阵',
  taiyi: '太乙局盘', astrology: '西方占星盘', almanac: '黄历择日',
} as const;

export type AgentChartKind = keyof typeof AGENT_CHART_NAMES;

export function isAgentChartTool(name: string): name is AgentChartKind {
  return Object.hasOwn(AGENT_CHART_NAMES, name);
}

/** Every tool belongs to exactly one family; each family has one result presentation. */
export type AgentToolFamily =
  | 'chart'
  | 'calculation'
  | 'search'
  | 'data'
  | 'method'
  | 'plan'
  | 'question'
  | 'collaboration'
  | 'memory'
  | 'artifacts'
  | 'external'
  | 'other';

const TOOL_FAMILIES: ReadonlyMap<string, AgentToolFamily> = new Map<string, AgentToolFamily>([
  ['inspect_chart', 'chart'],
  ['focus_chart', 'chart'],
  ['bazi_dayun', 'calculation'],
  ['bazi_pillars_resolve', 'calculation'],
  ['ziwei_horoscope', 'calculation'],
  ['ziwei_flying_star', 'calculation'],
  ['web_search', 'search'],
  ['search_knowledge', 'search'],
  ['list_user_data', 'data'],
  ['read_user_data', 'data'],
  ['read_user_profile', 'data'],
  ['read_attachment', 'data'],
  ['list_analysis_methods', 'method'],
  ['load_analysis_method', 'method'],
  ['todo_write', 'plan'],
  ['ask_user', 'question'],
  ['parallel_analysis', 'collaboration'],
  ['read_user_memory', 'memory'],
  ['remember_user_fact', 'memory'],
  ['select_final_artifacts', 'artifacts'],
]);

/** Administrator-configured MCP tools are registered as `mcp__<server>__<tool>`. */
const EXTERNAL_TOOL_PREFIX = 'mcp__';

export function getAgentToolFamily(name: string): AgentToolFamily {
  if (isAgentChartTool(name)) return 'chart';
  if (name.startsWith(EXTERNAL_TOOL_PREFIX)) return 'external';
  return TOOL_FAMILIES.get(name) ?? 'other';
}

/**
 * Tools whose model-visible text is the canonical Core or data-provider
 * rendering. The projection keeps that text on the public tool part so text
 * fallbacks and exports never have to re-render or guess from raw JSON.
 */
export function projectsAgentCanonicalText(name: string): boolean {
  return isAgentChartTool(name) || TOOL_FAMILIES.get(name) === 'calculation' || name === 'inspect_chart' || name === 'read_user_data';
}
