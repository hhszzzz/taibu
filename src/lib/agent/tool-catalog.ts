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

/**
 * 详查工具及其所属盘种：对一张已排好的盘做局部深查，不产生新成果。
 * 与 Core 工具的 derivesFrom 一一对应（agent-tool-catalog 测试校验）。
 */
export const AGENT_DRILLDOWN_BASES = {
  bazi_relations: 'bazi',
  bazi_wuxing: 'bazi',
  bazi_liunian_scan: 'bazi',
  ziwei_palace: 'ziwei',
  qimen_palace: 'qimen',
  daliuren_lessons: 'daliuren',
  astrology_point: 'astrology',
  liuyao_line: 'liuyao',
} as const satisfies Record<string, AgentChartKind>;

export type AgentDrilldownTool = keyof typeof AGENT_DRILLDOWN_BASES;

export function getAgentDrilldownBase(name: string): AgentChartKind | null {
  return Object.hasOwn(AGENT_DRILLDOWN_BASES, name) ? AGENT_DRILLDOWN_BASES[name as AgentDrilldownTool] : null;
}

/**
 * Admin-visible Agent capability scopes. These are deliberately separate from
 * public feature modules: an administrator can keep a page or MCP capability
 * available while preventing Agent from using the corresponding tool family.
 */
export const AGENT_TOOL_SCOPE_DEFINITIONS = [
  { id: 'bazi', label: '八字工具', description: '排八字、四柱反推与推算时辰、八字详查与岁运分析。' },
  { id: 'ziwei', label: '紫微工具', description: '排紫微命盘、限运、飞星与宫位详查。' },
  { id: 'qimen', label: '奇门工具', description: '排奇门遁甲及宫位详查。' },
  { id: 'liuyao', label: '六爻工具', description: '排六爻卦盘及爻位详查。' },
  { id: 'meihua', label: '梅花工具', description: '排梅花易数卦盘。' },
  { id: 'daliuren', label: '大六壬工具', description: '排大六壬天地盘及三传详查。' },
  { id: 'xiaoliuren', label: '小六壬工具', description: '排小六壬课盘。' },
  { id: 'tarot', label: '塔罗工具', description: '抽取和解读塔罗牌阵。' },
  { id: 'taiyi', label: '太乙工具', description: '排太乙局盘。' },
  { id: 'astrology', label: '占星工具', description: '排西方占星盘及星体详查。' },
  { id: 'almanac', label: '黄历工具', description: '计算黄历和择日信息。' },
  { id: 'user-data', label: '用户资料工具', description: '读取用户命盘、记录、笔记、附件和个性化档案。' },
  { id: 'knowledge', label: '知识库检索', description: '检索管理员或用户配置的知识库。' },
  { id: 'memory', label: '长期记忆', description: '读取、写入长期记忆及检索历史对话。' },
  { id: 'web', label: '联网与 MCP', description: '联网搜索以及外部 MCP 工具。' },
  { id: 'archive', label: '档案写入', description: '记录用户事件或生成档案保存卡片。' },
  { id: 'collaboration', label: 'Agent 协作', description: '并行分析和后台子分析。' },
  { id: 'code', label: '代码模式', description: '允许 Agent 使用脚本批量调用工具。' },
] as const;

export type AgentToolScopeId = (typeof AGENT_TOOL_SCOPE_DEFINITIONS)[number]['id'];
export const AGENT_TOOL_SCOPE_IDS: readonly AgentToolScopeId[] = AGENT_TOOL_SCOPE_DEFINITIONS.map(({ id }) => id);

export function getAgentToolScopeLabel(scope: AgentToolScopeId): string {
  return AGENT_TOOL_SCOPE_DEFINITIONS.find(item => item.id === scope)?.label ?? scope;
}

/** Return the public feature module behind a Core chart/calculation tool. */
export function getAgentToolFeatureId(name: string): AgentChartKind | null {
  if (isAgentChartTool(name)) return name;
  const drilldown = getAgentDrilldownBase(name);
  if (drilldown) return drilldown;
  switch (name) {
    case 'bazi_dayun':
    case 'bazi_pillars_resolve':
    case 'bazi_hour_candidates':
    case 'bazi_hepan':
      return 'bazi';
    case 'ziwei_horoscope':
    case 'ziwei_flying_star':
      return 'ziwei';
    case 'almanac_select':
      return 'almanac';
    default:
      for (const domain of Object.keys(AGENT_CHART_NAMES) as AgentChartKind[]) {
        if (name.startsWith(`${domain}_`)) return domain;
      }
      return null;
  }
}

/** Static Agent tools that belong to an administrator-configurable scope. */
export function getAgentToolScope(name: string): AgentToolScopeId | null {
  const feature = getAgentToolFeatureId(name);
  if (feature && (AGENT_TOOL_SCOPE_IDS as readonly string[]).includes(feature)) return feature;
  if (name.startsWith('mcp__') || name === 'web_search') return 'web';
  if (name === 'search_knowledge') return 'knowledge';
  if (['list_user_data', 'read_user_data', 'read_user_notes', 'read_user_profile', 'read_attachment'].includes(name)) return 'user-data';
  if (['read_user_memory', 'remember_user_fact', 'search_conversations'].includes(name)) return 'memory';
  if (name === AGENT_ARCHIVE_TOOLS.record || name === AGENT_ARCHIVE_TOOLS.propose) return 'archive';
  if (name === 'parallel_analysis' || name === AGENT_BACKGROUND_TOOL) return 'collaboration';
  if (name === AGENT_CODEMODE_TOOL) return 'code';
  return null;
}

/** Every tool belongs to exactly one family; each family has one result presentation. */
export type AgentToolFamily =
  | 'chart'
  | 'calculation'
  | 'drilldown'
  | 'search'
  | 'data'
  | 'method'
  | 'plan'
  | 'todo'
  | 'question'
  | 'collaboration'
  | 'memory'
  | 'archive'
  | 'code'
  | 'external'
  | 'other';

/** Pi's code mode tool (`CODEMODE_TOOL_NAME`); its scripts' calls are parts with `parentId`. */
export const AGENT_CODEMODE_TOOL = 'codemode';

/** The Taibu tool that loads deferred tools (`tool-search.server.ts`). */
export const AGENT_TOOL_SEARCH_TOOL = 'tool_search';

/** The plan-mode tool (`runtime.server.ts`): submits a plan and waits for the user's decision. */
export const AGENT_SUBMIT_PLAN_TOOL = 'submit_plan';

/** The tool that manages a conversation's background subagents (`background.server.ts`). */
export const AGENT_BACKGROUND_TOOL = 'background_agent';

/** Task kinds of the background subagents: the task owning a subagent's conversation, and one message's delivery and report. */
export const AGENT_BACKGROUND_TASKS = { anchor: 'taibu.background-anchor', reporter: 'taibu.background-reporter' } as const;

/** Tools whose cards list members: a collaboration's, or the one subagent a background message went to. */
export function isAgentMemberTool(name: string): boolean {
  return name === 'parallel_analysis' || name === AGENT_BACKGROUND_TOOL;
}

/** The archive tools (archive.ts): an event recorded from the user's own words, and a card the user saves. */
export const AGENT_ARCHIVE_TOOLS = { record: 'record_user_event', propose: 'propose_archive_entry' } as const;

/**
 * Tools a plan-mode task may not use until the user approves its plan: writing memory or the archive and dispatching
 * members are the execution the plan asks about. Research tools stay available, so the plan can be grounded.
 */
export const AGENT_PLAN_GATED_TOOLS: ReadonlySet<string> = new Set(['remember_user_fact', AGENT_ARCHIVE_TOOLS.record, 'parallel_analysis', AGENT_BACKGROUND_TOOL]);

/**
 * The Core tools the model loads on demand: the drilldowns and calculations a reading reaches for once it already has
 * a chart. The same list as Core's `DEFERRED_TOOL_NAMES` (a test holds them equal), copied so this module stays browser-safe.
 */
export const AGENT_CORE_DEFERRED_TOOLS: readonly string[] = [
  'bazi_relations', 'bazi_wuxing', 'bazi_liunian_scan', 'ziwei_palace', 'qimen_palace', 'daliuren_lessons',
  'astrology_point', 'liuyao_line',
  'bazi_dayun', 'bazi_pillars_resolve', 'ziwei_horoscope', 'ziwei_flying_star', 'almanac_select', 'bazi_hepan',
  'bazi_hour_candidates',
];

/** The user's own material a reading rarely needs: daily notes, and other conversations (with long-term memory on). */
export const AGENT_DATA_DEFERRED_TOOLS: readonly string[] = ['read_user_notes', 'search_conversations'];

/**
 * Tools the model loads on demand instead of being offered every request. `tool_search` loads them; scripts may
 * call them without loading.
 */
export const AGENT_DEFERRED_TOOLS: ReadonlySet<string> = new Set([...AGENT_CORE_DEFERRED_TOOLS, ...AGENT_DATA_DEFERRED_TOOLS]);

/** MCP tools, the platform's and the user's own connectors', are registered as `mcp__<server>__<tool>`. */
export const AGENT_MCP_TOOL_PREFIX = 'mcp__';

/** Whether a Taibu tool is deferred. An MCP tool is deferred or not as its server's exposure says. */
export function isAgentDeferredTool(name: string): boolean {
  return AGENT_DEFERRED_TOOLS.has(name);
}

/** Titles of tools that Pi extensions define, which have no Taibu label. */
const EXTENSION_TOOL_TITLES: Readonly<Record<string, string>> = {
  [AGENT_CODEMODE_TOOL]: '运行脚本',
  [AGENT_TOOL_SEARCH_TOOL]: '查找工具',
  [AGENT_SUBMIT_PLAN_TOOL]: '提交计划',
  [AGENT_BACKGROUND_TOOL]: '后台子分析',
};

export function getAgentExtensionToolTitle(name: string): string | undefined {
  return Object.hasOwn(EXTENSION_TOOL_TITLES, name) ? EXTENSION_TOOL_TITLES[name] : undefined;
}

/**
 * Tools a code mode script may not call: they ask the user, move the board, search with citations, write memory or
 * the archive, load guidance or dispatch members, each of which the model must do itself.
 */
export const AGENT_MODEL_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'ask_user', 'todo_write', 'inspect_chart', 'focus_chart', 'web_search', 'search_knowledge', 'read_attachment',
  'list_analysis_methods', 'load_analysis_method', 'read_user_memory', 'remember_user_fact', AGENT_SUBMIT_PLAN_TOOL,
  AGENT_ARCHIVE_TOOLS.record, AGENT_ARCHIVE_TOOLS.propose, 'parallel_analysis', AGENT_BACKGROUND_TOOL,
]);

/** Charts, calculations and drilldowns give scripts `{ artifactId?, text, data }`; other tools give their text. */
export function returnsAgentScriptResult(name: string): boolean {
  return isAgentChartTool(name) || getAgentDrilldownBase(name) !== null || TOOL_FAMILIES.get(name) === 'calculation';
}

const TOOL_FAMILIES: ReadonlyMap<string, AgentToolFamily> = new Map<string, AgentToolFamily>([
  ['inspect_chart', 'chart'],
  ['focus_chart', 'chart'],
  ['bazi_dayun', 'calculation'],
  ['bazi_pillars_resolve', 'calculation'],
  ['ziwei_horoscope', 'calculation'],
  ['ziwei_flying_star', 'calculation'],
  ['almanac_select', 'calculation'],
  ['bazi_hepan', 'calculation'],
  ['bazi_hour_candidates', 'calculation'],
  ['web_search', 'search'],
  ['search_knowledge', 'search'],
  ['list_user_data', 'data'],
  ['read_user_data', 'data'],
  ['read_user_notes', 'data'],
  ['search_conversations', 'data'],
  ['read_user_profile', 'data'],
  ['read_attachment', 'data'],
  ['list_analysis_methods', 'method'],
  ['load_analysis_method', 'method'],
  ['todo_write', 'todo'],
  [AGENT_SUBMIT_PLAN_TOOL, 'plan'],
  ['ask_user', 'question'],
  ['parallel_analysis', 'collaboration'],
  [AGENT_BACKGROUND_TOOL, 'collaboration'],
  ['read_user_memory', 'memory'],
  ['remember_user_fact', 'memory'],
  [AGENT_ARCHIVE_TOOLS.record, 'archive'],
  [AGENT_ARCHIVE_TOOLS.propose, 'archive'],
  [AGENT_CODEMODE_TOOL, 'code'],
]);

export function getAgentToolFamily(name: string): AgentToolFamily {
  if (isAgentChartTool(name)) return 'chart';
  if (getAgentDrilldownBase(name)) return 'drilldown';
  if (name.startsWith(AGENT_MCP_TOOL_PREFIX)) return 'external';
  return TOOL_FAMILIES.get(name) ?? 'other';
}

/**
 * Tools whose model-visible text is the canonical Core or data-provider
 * rendering. The projection keeps that text on the public tool part so text
 * fallbacks and exports never have to re-render or guess from raw JSON.
 */
export function projectsAgentCanonicalText(name: string): boolean {
  return isAgentChartTool(name) || TOOL_FAMILIES.get(name) === 'calculation' || getAgentDrilldownBase(name) !== null
    || name === 'inspect_chart' || name === 'read_user_data';
}

/**
 * inspect_chart 写给模型的定位目录（每行「- 目标 ID｜位置」）以此开头。它只是 focus_chart
 * 可用 ID 的清单，不是规范文本，投影时不进公开步骤；按宫位查看只回这份目录。
 */
export const CHART_TARGET_DIRECTORY_HEADING = '## 定位目标（focus_chart 的 targetIds）';
