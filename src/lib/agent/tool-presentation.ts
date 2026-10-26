import type { BaziCanonicalJSON, BaziHepanCanonicalJSON, BaziHourCandidatesCanonicalJSON } from 'taibu-core/bazi';
import type { ZiweiCanonicalJSON } from 'taibu-core/ziwei';
import type { QimenCanonicalJSON } from 'taibu-core/qimen';
import type { LiuyaoCanonicalJSON, LiuyaoJSON } from 'taibu-core/liuyao';
import type { MeihuaCanonicalJSON } from 'taibu-core/meihua';
import type { DaliurenCanonicalJSON } from 'taibu-core/daliuren';
import type { XiaoliurenCanonicalJSON } from 'taibu-core/xiaoliuren';
import type { TarotCanonicalJSON } from 'taibu-core/tarot';
import type { TaiyiCanonicalJSON } from 'taibu-core/taiyi';
import type { AstrologyCanonicalJSON } from 'taibu-core/astrology';
import type { AlmanacCanonicalJSON } from 'taibu-core/almanac';
import type { AlmanacSelectCanonicalJSON } from 'taibu-core/almanac';
import type { DayunCanonicalJSON } from 'taibu-core/bazi-dayun';
import type { BaziPillarsResolveCanonicalJSON } from 'taibu-core/bazi-pillars-resolve';
import type { ZiweiHoroscopeCanonicalJSON } from 'taibu-core/ziwei-horoscope';
import type { ZiweiFlyingStarCanonicalJSON } from 'taibu-core/ziwei-flying-star';
import { normalizeQuestions, type AgentQuestion } from './questions';
import type { AgentPart } from './types';
import { AGENT_CHART_NAMES, AGENT_CODEMODE_TOOL, AGENT_SUBMIT_PLAN_TOOL, AGENT_WEB_TOOLS, isAgentChartTool, type AgentChartKind } from './tool-catalog';
import { estimateTokens } from './token-estimate';

export type AgentToolPart = Extract<AgentPart, { type: 'tool' }>;
/**
 * The liuyao board the workspace draws: Core's canonical JSON, or MCP's AI-safe board
 * flattened into it. The AI-safe board's hexagram-level interplay (六冲六合、反伏、合局)
 * has no canonical counterpart, so it rides along as Core returned it.
 */
export type AgentLiuyaoChart = LiuyaoCanonicalJSON & { 全局互动?: LiuyaoJSON['全局互动'] };
type ChartJson = {
  bazi: BaziCanonicalJSON; ziwei: ZiweiCanonicalJSON; qimen: QimenCanonicalJSON;
  liuyao: AgentLiuyaoChart; meihua: MeihuaCanonicalJSON; daliuren: DaliurenCanonicalJSON;
  xiaoliuren: XiaoliurenCanonicalJSON; tarot: TarotCanonicalJSON;
  taiyi: TaiyiCanonicalJSON; astrology: AstrologyCanonicalJSON; almanac: AlmanacCanonicalJSON;
};
/** Keyed by the catalog: a chart kind without a canonical JSON type fails to compile. */
type ChartTypes = { [K in AgentChartKind]: ChartJson[K] };
export type AgentChart = { [K in keyof ChartTypes]: { kind: K; chart: ChartTypes[K]; title: string; summary: string } }[keyof ChartTypes];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function strings(value: unknown, keys: string[]) { const row = record(value); return keys.every(key => typeof row[key] === 'string'); }
function arrayRows(value: unknown, keys: string[]) { return Array.isArray(value) && value.every(row => strings(row, keys)); }
function stringArray(value: unknown) { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
function rows(value: unknown, length: number, keys: string[]) {
  return Array.isArray(value) && value.length === length && arrayRows(value, keys);
}
/** 八字的柱数：标了「出生时辰」（时辰未知）的盘只有年、月、日三柱 */
const pillarCount = (info: Record<string, unknown>) => typeof info.出生时辰 === 'string' ? 3 : 4;
export function getAgentToolArtifactId(tool: AgentToolPart): string | null {
  const id = record(tool.output).artifactId;
  return typeof id === 'string' && id ? id : null;
}

/** Final saved links and their original tool results refer to one reading. */
export function getAgentUnrepresentedArtifacts<T extends { id: string }>(tools: AgentToolPart[], artifacts: T[]): T[] {
  const shown = new Set(tools.filter(tool => tool.status === 'completed' && isAgentChartTool(tool.name)).map(getAgentToolArtifactId));
  return artifacts.filter(artifact => !shown.has(artifact.id));
}

/** Read persisted tool data only. No calculation, random draw, save or AI request. */
export function getAgentChart(tool: AgentToolPart): AgentChart | null {
  if (tool.status !== 'completed') return null;
  const output = record(tool.output);
  const name = tool.name === 'inspect_chart' && typeof output.chartKind === 'string' ? output.chartKind : tool.name;
  if (!isAgentChartTool(name)) return null;
  // Durable calculation results carry an artifact envelope with the full-detail board; older ones only the model's
  // default-level result, and legacy results may be bare canonical JSON.
  const chart = record(Object.hasOwn(output, 'board') ? output.board : Object.hasOwn(output, 'result') ? output.result : output);
  const basic = record(chart.基本信息);
  const board = record(chart.卦盘);
  const main = record(board.本卦);
  const title = AGENT_CHART_NAMES[name];
  switch (name) {
    case 'bazi':
      if (!strings(basic, ['性别', '日主']) || !rows(chart.四柱, pillarCount(basic), ['柱', '干支', '天干十神', '地势']) || !Array.isArray(chart.干支关系)) return null;
      return { kind: 'bazi', chart: chart as unknown as BaziCanonicalJSON, title, summary: (chart.四柱 as BaziCanonicalJSON['四柱']).map(pillar => pillar.干支).join(' · ') };
    case 'ziwei':
      if (!strings(basic, ['阳历', '农历', '四柱', '命主', '身主', '五行局']) || !rows(chart.十二宫位, 12, ['宫位', '干支', '是否身宫'])) return null;
      return { kind: 'ziwei', chart: chart as unknown as ZiweiCanonicalJSON, title, summary: `${basic.五行局} · 命主 ${basic.命主} · 身主 ${basic.身主}` };
    case 'qimen':
      if (!strings(basic, ['四柱', '局式', '值符', '值使']) || !rows(chart.九宫盘, 9, ['宫名', '宫位', '八神', '九星', '八门', '天盘天干', '地盘天干'])) return null;
      if (!(chart.九宫盘 as unknown[]).every(palace => Number.isInteger(record(palace).宫位序号) && Number(record(palace).宫位序号) >= 1 && Number(record(palace).宫位序号) <= 9) || new Set((chart.九宫盘 as unknown[]).map(palace => record(palace).宫位序号)).size !== 9) return null;
      return { kind: 'qimen', chart: chart as unknown as QimenCanonicalJSON, title, summary: `${basic.局式} · 值符 ${basic.值符} · 值使 ${basic.值使}` };
    case 'liuyao':
      if (!strings(main, ['卦名', '卦宫', '五行'])) return null;
      if (rows(chart.六爻, 6, ['爻位', '六亲', '六神', '纳甲', '五行', '旺衰', '动静'])) {
        return { kind: 'liuyao', chart: chart as unknown as LiuyaoCanonicalJSON, title, summary: [main.卦名, record(board.变卦).卦名].filter(Boolean).join(' → ') };
      }
      {
        const lines = record(chart.六爻全盘).爻列表;
        if (!rows(lines, 6, ['爻位', '六神']) || !(lines as unknown[]).every(line => strings(record(line).本爻, ['六亲', '纳甲', '五行']))) return null;
        // MCP's slim board uses nested 本爻. Flatten for the shared Web view;
        // omitted strength/movement fields remain blank, never inferred.
        const displayedBoard = { ...board };
        for (const key of ['互卦', '错卦', '综卦']) if (strings(record(board.衍生卦)[key], ['卦名'])) displayedBoard[key] = record(board.衍生卦)[key];
        const display: AgentLiuyaoChart = {
          卦盘: displayedBoard as unknown as LiuyaoCanonicalJSON['卦盘'],
          干支时间: Array.isArray(board.干支时间) ? board.干支时间 as LiuyaoCanonicalJSON['干支时间'] : [],
          六爻: (lines as unknown[]).map(value => {
            const line = record(value);
            const current = record(line.本爻);
            return { 爻位: String(line.爻位), 六神: String(line.六神), 六亲: String(current.六亲), 纳甲: String(current.纳甲), 五行: String(current.五行), 旺衰: typeof current.旺衰 === 'string' ? current.旺衰 : '', 动静: typeof line.动静 === 'string' ? line.动静 : '',
              ...(typeof line.世应 === 'string' ? { 世应: line.世应 } : {}),
              ...(typeof line.空亡 === 'string' ? { 空亡: line.空亡 } : {}),
              ...(Array.isArray(line.神煞) ? { 神煞: line.神煞 as string[] } : {}),
              ...(strings(line.变爻, ['六亲', '纳甲', '五行']) ? { 变爻: { ...line.变爻 as { 六亲: string; 纳甲: string; 五行: string }, 关系: typeof line.化变 === 'string' ? line.化变 : '' } } : {}),
              ...(strings(line.伏神, ['六亲', '纳甲', '五行']) ? { 伏神: { ...line.伏神 as { 六亲: string; 纳甲: string; 五行: string }, 关系: '' } } : {}),
            };
          }), 用神分析: [], 卦级分析: [], 提示: [],
          ...(Array.isArray(board.全局神煞) ? { 全局神煞: board.全局神煞 as string[] } : {}),
          ...(Array.isArray(record(chart.全局互动).组合关系) ? { 全局互动: chart.全局互动 as unknown as LiuyaoJSON['全局互动'] } : {}),
        };
        return { kind: 'liuyao', chart: display, title, summary: [main.卦名, record(board.变卦).卦名].filter(Boolean).join(' → ') };
      }
    case 'meihua':
      if (!strings(chart.起卦信息, ['问题', '方法']) || !strings(main, ['卦名', '上卦', '下卦', '整卦五行']) || !strings(board.变卦, ['卦名', '上卦', '下卦', '整卦五行']) || typeof board.动爻 !== 'string') return null;
      return { kind: 'meihua', chart: chart as unknown as MeihuaCanonicalJSON, title, summary: `${main.卦名} → ${record(board.变卦).卦名} · ${board.动爻}` };
    case 'daliuren':
      if (!strings(basic, ['课式']) || !Array.isArray(record(basic.关键状态).空亡) || !rows(chart.天地盘, 12, ['天盘', '地盘']) || !rows(chart.三传, 3, ['地支']) || !rows(chart.四课, 4, ['课别', '上神', '下神'])) return null;
      return { kind: 'daliuren', chart: chart as unknown as DaliurenCanonicalJSON, title, summary: `${basic.课式} · ${(chart.三传 as DaliurenCanonicalJSON['三传']).map(row => row.地支).join(' → ')}` };
    case 'xiaoliuren':
      if (!strings(chart.推演链, ['月上起', '日上落', '时上落']) || !strings(chart.结果, ['落宫', '五行', '方位', '性质']) || !strings(chart.起课信息, ['时辰'])) return null;
      return { kind: 'xiaoliuren', chart: chart as unknown as XiaoliurenCanonicalJSON, title, summary: `${record(chart.结果).落宫} · ${record(chart.结果).性质} · ${record(chart.结果).五行}` };
    case 'tarot':
      if (!strings(chart.问卜设定, ['牌阵']) || !Array.isArray(chart.牌阵展开) || chart.牌阵展开.length < 1 || chart.牌阵展开.length > 78 || !chart.牌阵展开.every(row => strings(row, ['位置', '塔罗牌', '状态']) && Array.isArray(record(row).核心基调))) return null;
      return { kind: 'tarot', chart: chart as unknown as TarotCanonicalJSON, title, summary: `${record(chart.问卜设定).牌阵} · ${chart.牌阵展开.length} 张牌` };
    case 'taiyi': {
      if (!strings(chart.问卜与时空底盘, ['时间', '四柱']) || !Array.isArray(chart.九星阵列)) return null;
      const palaces = record(chart.太乙七十二局).十六宫;
      if (chart.太乙七十二局 ? chart.九星阵列.length !== 0 || ![16, 17].some(length => rows(palaces, length, ['宫位', '宫神'])) || !(palaces as unknown[]).every(palace => stringArray(record(palace).星将))
        : !chart.九星阵列.length || !arrayRows(chart.九星阵列, ['观测层级', '太乙名', '宫位'])) return null;
      return { kind: 'taiyi', chart: chart as unknown as TaiyiCanonicalJSON, title, summary: `${record(chart.问卜与时空底盘).时间} · ${record(chart.太乙七十二局).局式 ?? '九星层级'}` };
    }
    case 'astrology': {
      if (!strings(chart.基础坐标, ['计算模式', '本命时刻', '黄道体系', '宫制']) || !rows(chart.本命主星, 10, ['因素', '星座', '黄经']) || !Array.isArray(chart.当前流运触发)) return null;
      const anchors = record(chart.命盘锚点), extra = record(chart.扩展信息);
      if (!['太阳', '月亮'].every(key => strings(anchors[key], ['星座', '黄经'])) || ['上升', '天顶'].some(key => anchors[key] !== undefined && !strings(anchors[key], ['星座', '黄经']))) return null;
      if (!(chart.本命主星 as unknown[]).every(planet => arrayRows(record(planet).关键相位, ['对象', '相位'])) || !chart.当前流运触发.every(planet => strings(planet, ['流运星体', '星座', '黄经']) && arrayRows(record(planet).触发相位, ['对象', '相位']))) return null;
      if (extra.宫位宫头 !== undefined && !arrayRows(extra.宫位宫头, ['宫位', '宫头星座', '宫头黄经'])) return null;
      if (extra.附加点与交点 !== undefined && (!arrayRows(extra.附加点与交点, ['因素']) || !(extra.附加点与交点 as unknown[]).every(point => strings(record(point).本命, ['星座', '黄经'])))) return null;
      if (extra.完整相位矩阵 !== undefined && !['本命', '流运'].every(key => arrayRows(record(extra.完整相位矩阵)[key], ['起点', '终点', '相位']))) return null;
      return { kind: 'astrology', chart: chart as unknown as AstrologyCanonicalJSON, title, summary: `${record(chart.基础坐标).计算模式} · ${record(chart.基础坐标).黄道体系} · ${record(chart.基础坐标).本命时刻}` };
    }
    case 'almanac': {
      if (!strings(chart.基础与个性化坐标, ['日期', '日干支']) || !strings(chart.传统黄历基调, ['农历', '生肖']) || !stringArray(record(chart.择日宜忌).宜) || !stringArray(record(chart.择日宜忌).忌) || !chart.神煞参考 || typeof chart.神煞参考 !== 'object' || Array.isArray(chart.神煞参考)) return null;
      if (['吉神宜趋', '凶煞宜忌'].some(key => record(chart.神煞参考)[key] !== undefined && !stringArray(record(chart.神煞参考)[key]))) return null;
      if (chart.时辰吉凶 !== undefined && !arrayRows(chart.时辰吉凶, ['时辰'])) return null;
      return { kind: 'almanac', chart: chart as unknown as AlmanacCanonicalJSON, title, summary: `${record(chart.基础与个性化坐标).日期} · ${record(chart.基础与个性化坐标).日干支} · ${record(chart.传统黄历基调).农历}` };
    }
  }
}

export type AgentScriptCallStatus = 'running' | 'ok' | 'error' | 'cancelled';
/** A row of a script's call list; `id` is the call's number, which the part of a call that ran keeps as `scriptCall`. */
export interface AgentScriptCall { id: number; name: string; args: string; status: AgentScriptCallStatus; error: string | null }
export interface AgentScript { code: string; output: string | null; calls: AgentScriptCall[] }
const SCRIPT_CALL_STATUSES: readonly string[] = ['running', 'ok', 'error', 'cancelled'] satisfies AgentScriptCallStatus[];

/**
 * A code mode script: the code the model wrote, what it printed for the model, and once it settled every call it made
 * as Pi listed them, including calls that never ran. The calls that ran are also parts of their own (`parentId`).
 */
export function getAgentScript(tool: AgentToolPart): AgentScript | null {
  const code = record(tool.input).code;
  if (tool.name !== AGENT_CODEMODE_TOOL || typeof code !== 'string') return null;
  const output = record(tool.output);
  return {
    code,
    output: typeof output.output === 'string' ? output.output : null,
    calls: Array.isArray(output.calls) ? output.calls.flatMap(item => {
      const row = record(item);
      return Number.isSafeInteger(row.id) && typeof row.name === 'string' && typeof row.status === 'string' && SCRIPT_CALL_STATUSES.includes(row.status)
        ? [{ id: row.id as number, name: row.name, args: typeof row.args === 'string' ? row.args : '', status: row.status as AgentScriptCallStatus, error: typeof row.error === 'string' ? row.error : null }]
        : [];
    }) : [],
  };
}

export function getAgentToolText(tool: AgentToolPart): string | null {
  if (tool.canonicalText?.trim()) return tool.canonicalText;
  if (typeof tool.output === 'string') return tool.output;
  if (Array.isArray(tool.output) && tool.output.every(item => strings(item, ['text']) && record(item).type === 'text')) return tool.output.map(item => record(item).text).join('\n\n');
  return null;
}

/** Evidence number the server stamped on a returned row; anything else is not a citation. */
export function readAgentCite(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export type AgentSearchMethod = 'fts' | 'trigram' | 'vector';
const SEARCH_METHODS: readonly string[] = ['fts', 'trigram', 'vector'] satisfies AgentSearchMethod[];

export interface AgentSearchResult {
  id: string;
  title: string;
  /** The returned text, unchanged. */
  content: string;
  /** The text to quote: content without the heading already shown as the title. */
  excerpt: string;
  url: string | null;
  /** Number the model was given to cite this row; null for rows saved before numbering. */
  cite: number | null;
  /** How a knowledge-base passage matched; null for web pages and older rows. */
  method: AgentSearchMethod | null;
  /** The file, category or site the row came from, when it says so. */
  source: string | null;
}

const nonEmpty = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const hostname = (url: string) => { try { return new URL(url).hostname; } catch { return null; } };

export function getAgentSearchResults(tool: AgentToolPart): AgentSearchResult[] | null {
  if (tool.status !== 'completed' || !(AGENT_WEB_TOOLS.has(tool.name) || tool.name === 'search_knowledge') || !Array.isArray(tool.output)) return null;
  return tool.output.filter(item => strings(item, ['content'])).map((item, index) => {
    const row = record(item);
    const metadata = record(row.metadata);
    const content = String(row.content);
    const url = typeof row.url === 'string' && /^https?:\/\//iu.test(row.url) ? row.url : null;
    // Knowledge records are stored with their title as the first heading of every chunk.
    const heading = /^\s*#{1,6}[ \t]+([^\n]+?)[ \t#]*(?:\r?\n|$)/u.exec(content);
    const named = nonEmpty(row.title) ?? nonEmpty(metadata.title) ?? nonEmpty(metadata.sourceTitle);
    const title = named ?? nonEmpty(heading?.[1]) ?? nonEmpty(metadata.file_name) ?? `资料 ${index + 1}`;
    const excerpt = !named && heading && content.slice(heading[0].length).trim() ? content.slice(heading[0].length).trim() : content;
    const file = nonEmpty(metadata.file_name);
    return {
      id: `${tool.id}:${index}`, title, content, excerpt, url, cite: readAgentCite(row.cite),
      method: tool.name === 'search_knowledge' && typeof row.method === 'string' && SEARCH_METHODS.includes(row.method) ? row.method as AgentSearchMethod : null,
      source: url ? hostname(url) : (file !== title ? file : null) ?? nonEmpty(metadata.category),
    };
  });
}

export function getAgentDataResults(tool: AgentToolPart) {
  if (tool.status !== 'completed' || tool.name !== 'list_user_data') return null;
  const output = record(tool.output);
  if (!Array.isArray(output.items)) return null;
  return { items: output.items.filter(item => strings(item, ['id', 'type', 'name', 'preview'])).map(item => {
    const row = record(item);
    return { id: String(row.id), name: String(row.name), type: String(row.type), preview: String(row.preview) };
  }), errors: Array.isArray(output.errors) ? output.errors.filter(item => strings(item, ['message'])).map(item => {
    const row = record(item);
    return { type: typeof row.type === 'string' ? row.type : null, message: String(row.message) };
  }) : [] };
}

/** Daily notes read_user_notes returned, newest first; `more` when the limit cut older ones off. */
export function getAgentNotes(tool: AgentToolPart) {
  if (tool.status !== 'completed' || tool.name !== 'read_user_notes') return null;
  const output = record(tool.output);
  if (!Array.isArray(output.notes)) return null;
  return {
    notes: output.notes.filter(note => strings(note, ['date', 'content'])).map(note => {
      const row = record(note);
      return { date: String(row.date), mood: typeof row.mood === 'string' ? row.mood : null, content: String(row.content) };
    }),
    more: output.more === true,
  };
}

export interface AgentConversationHit {
  conversationId: string;
  /** The matched message, so a link opens the conversation at it. */
  messageId: string | null;
  title: string;
  updatedAt: string;
  role: 'user' | 'assistant';
  excerpt: string;
  /** The start of the answer a matched question got, or the question a matched answer replied to. */
  reply: string | null;
  question: string | null;
}

/** Messages search_conversations found in the user's other conversations, latest conversation first. */
export function getAgentConversationHits(tool: AgentToolPart): AgentConversationHit[] | null {
  if (tool.status !== 'completed' || tool.name !== 'search_conversations' || !Array.isArray(tool.output)) return null;
  return tool.output.filter(hit => strings(hit, ['conversationId', 'excerpt']) && ['user', 'assistant'].includes(String(record(hit).role))).map(hit => {
    const row = record(hit);
    return {
      conversationId: String(row.conversationId),
      messageId: typeof row.messageId === 'string' && row.messageId ? row.messageId : null,
      title: typeof row.title === 'string' && row.title.trim() ? row.title : '未命名对话',
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
      role: row.role as 'user' | 'assistant',
      excerpt: String(row.excerpt),
      reply: typeof row.reply === 'string' ? row.reply : null,
      question: typeof row.question === 'string' ? row.question : null,
    };
  });
}

export type AgentCalculation =
  | { kind: 'bazi_dayun'; data: DayunCanonicalJSON }
  | { kind: 'bazi_pillars_resolve'; data: BaziPillarsResolveCanonicalJSON }
  | { kind: 'ziwei_horoscope'; data: ZiweiHoroscopeCanonicalJSON }
  | { kind: 'ziwei_flying_star'; data: ZiweiFlyingStarCanonicalJSON }
  | { kind: 'almanac_select'; data: AlmanacSelectCanonicalJSON }
  | { kind: 'bazi_hepan'; data: BaziHepanCanonicalJSON }
  | { kind: 'bazi_hour_candidates'; data: BaziHourCandidatesCanonicalJSON };

/** Core calculation results; anything incomplete falls back to the projected canonical text. */
export function getAgentCalculation(tool: AgentToolPart): AgentCalculation | null {
  if (tool.status !== 'completed') return null;
  const output = record(tool.output);
  const data = record(Object.hasOwn(output, 'result') ? output.result : output);
  const relations = (value: unknown) => arrayRows(value, ['类型', '说明']) && (value as unknown[]).every(row => arrayRows(record(row).位置, ['柱', '部位', '字']));
  switch (tool.name) {
    case 'bazi_dayun': {
      const start = record(data.起运信息);
      if (typeof start.起运年龄 !== 'number' || typeof start.起运详情 !== 'string' || !Array.isArray(data.大运列表) || !data.大运列表.length) return null;
      // full 档的大运会带流年列表；字段异常时整卡回退到规范文本，避免渲染半截数据。
      const liunianOk = (value: unknown) => value === undefined || (Array.isArray(value)
        && value.every(entry => Number.isInteger(record(entry).流年) && typeof record(entry).干支 === 'string' && typeof record(entry).十神 === 'string'));
      if (!data.大运列表.every(item => strings(item, ['干支', '十神']) && Number.isInteger(record(item).起运年份) && arrayRows(record(item).藏干, ['天干', '十神']) && liunianOk(record(item).流年列表))) return null;
      return { kind: 'bazi_dayun', data: data as unknown as DayunCanonicalJSON };
    }
    case 'bazi_pillars_resolve':
      if (!strings(data.原始四柱, ['年柱', '月柱', '日柱', '时柱']) || !arrayRows(data.候选列表, ['农历', '公历', '出生时间', '是否闰月'])) return null;
      return { kind: 'bazi_pillars_resolve', data: data as unknown as BaziPillarsResolveCanonicalJSON };
    case 'ziwei_horoscope':
      if (!strings(data.基本信息, ['目标日期', '五行局']) || !arrayRows(data.运限叠宫, ['层次', '时间段备注', '干支', '落入本命宫位']) || !(data.运限叠宫 as unknown[]).every(row => stringArray(record(row).运限四化))) return null;
      return { kind: 'ziwei_horoscope', data: data as unknown as ZiweiHoroscopeCanonicalJSON };
    case 'ziwei_flying_star':
      if (!arrayRows(data.查询结果, ['查询类型']) || !(data.查询结果 as unknown[]).every(row => typeof record(row).查询序号 === 'number')) return null;
      return { kind: 'ziwei_flying_star', data: data as unknown as ZiweiFlyingStarCanonicalJSON };
    case 'almanac_select': {
      const query = record(data.查询);
      const stats = record(data.排除统计);
      if (typeof query.起止日期 !== 'string' || typeof query.天数 !== 'number' || (query.排除冲煞 !== undefined && !stringArray(query.排除冲煞))) return null;
      if (!['候选数', '犯忌', '无对应宜', '冲煞'].every(key => typeof stats[key] === 'number')) return null;
      if (!arrayRows(data.候选日, ['日期', '日干支', '冲煞']) || !(data.候选日 as unknown[]).every(row => stringArray(record(row).宜) && stringArray(record(row).忌))) return null;
      return { kind: 'almanac_select', data: data as unknown as AlmanacSelectCanonicalJSON };
    }
    case 'bazi_hepan': {
      if (!rows(data.双方, 2, ['称呼', '性别', '日主', '月令', '月令旺衰', '生肖'])) return null;
      if (!(data.双方 as unknown[]).every(person => rows(record(person).四柱, pillarCount(record(person)), ['柱', '干支', '纳音']) && stringArray(record(person).缺失五行))) return null;
      if (!stringArray(record(data.日主互见).说明) || !strings(data.日主互见, ['五行生克']) || !strings(data.年命纳音, ['说明', '五行生克'])) return null;
      if (!['日柱之间', '年柱之间', '其余关系'].every(key => relations(data[key])) || !stringArray(data.五行互补)) return null;
      return { kind: 'bazi_hepan', data: data as unknown as BaziHepanCanonicalJSON };
    }
    case 'bazi_hour_candidates': {
      if (!strings(data.出生日期, ['公历', '农历', '性别', '时区']) || !arrayRows(data.共有柱, ['柱', '干支']) || typeof data.候选数量 !== 'number') return null;
      const event = (value: unknown) => Number.isInteger(record(value).年份) && typeof record(value).流年 === 'string'
        && relations(record(value).关系) && stringArray(record(value).岁运提示);
      const candidate = (value: unknown) => {
        const row = record(value), clock = record(row.钟表时间), hour = record(row.时柱), birth = record(row.排盘参数);
        return Number.isInteger(row.序号) && strings(row, ['时辰', '命宫', '日主之根', '起运'])
          && strings(clock, ['开始', '结束']) && typeof clock.分钟数 === 'number' && rows(row.四柱, 4, ['柱', '干支'])
          && strings(hour, ['干支', '天干十神', '地势', '纳音']) && arrayRows(hour.藏干, ['天干', '十神'])
          && relations(row.时柱关系) && stringArray(row.月令透时干) && stringArray(row.缺失五行)
          && Number.isInteger(birth.出生时) && Number.isInteger(birth.出生分)
          && (row.前事 === undefined || (Array.isArray(row.前事) && row.前事.every(event)));
      };
      if (!Array.isArray(data.候选) || !data.候选.length || !data.候选.every(candidate)) return null;
      return { kind: 'bazi_hour_candidates', data: data as unknown as BaziHourCandidatesCanonicalJSON };
    }
    default:
      return null;
  }
}

export interface AgentMethodGuide { id: string; title: string; version: string; whenToUse: string | null; tools: string[]; instructions: string }

/** load_analysis_method returns a versioned, read-only guide; it never grants tools or membership. */
export function getAgentMethod(tool: AgentToolPart): AgentMethodGuide | null {
  if (tool.status !== 'completed' || tool.name !== 'load_analysis_method') return null;
  const output = record(tool.output);
  if (!strings(output, ['id', 'title', 'version', 'instructions'])) return null;
  return {
    id: String(output.id), title: String(output.title), version: String(output.version),
    whenToUse: typeof output.whenToUse === 'string' ? output.whenToUse : null,
    tools: stringArray(output.tools) ? output.tools as string[] : [],
    instructions: String(output.instructions),
  };
}

export function getAgentMethodCatalog(tool: AgentToolPart) {
  if (tool.status !== 'completed' || tool.name !== 'list_analysis_methods' || !arrayRows(tool.output, ['id', 'title', 'version'])) return null;
  return (tool.output as unknown[]).map(item => {
    const row = record(item);
    return { id: String(row.id), title: String(row.title), version: String(row.version), description: typeof row.description === 'string' ? row.description : typeof row.whenToUse === 'string' ? row.whenToUse : '' };
  });
}

export interface AgentSkill { id: string; title: string; version: string; tokens: number }

/**
 * 技能：本任务用的方法卡。目录随系统提示注入，正文由 load_analysis_method 读进上下文；
 * 这里按卡 id 去重（改版重载同一张卡只算一次），`id` 就是它在工作区的页。
 * token 读卡上记的模型计数（运行时按网关 count_tokens 计）；早先的任务没有记，按 `model` 的 tokenizer 家族估算
 * 模型当时读到的文本（卡的 JSON）。
 */
export function getAgentSkills(tools: readonly AgentToolPart[], model = '') {
  const cards = new Map<string, AgentSkill>();
  let listed = false;
  for (const tool of tools) {
    if (getAgentMethodCatalog(tool)) listed = true;
    const guide = getAgentMethod(tool);
    if (!guide) continue;
    const counted = record(tool.output).tokens;
    const tokens = typeof counted === 'number' && counted >= 0 ? counted : estimateTokens(model, JSON.stringify(tool.output));
    cards.set(guide.id, { id: `method:${guide.id}`, title: guide.title, version: guide.version, tokens });
  }
  return { listed, cards: [...cards.values()] };
}

export interface AgentToolSearchLoaded { names: string[]; labels: string[] }

/** 工具搜索加载了哪些工具：名称与中文标题；旧记录只有名称，标题退回名称。 */
export function getAgentToolSearchLoaded(tool: AgentToolPart): AgentToolSearchLoaded | null {
  if (tool.status !== 'completed' || tool.name !== 'tool_search' || !tool.output || typeof tool.output !== 'object') return null;
  const output = tool.output as { loaded?: unknown; labels?: unknown };
  if (!Array.isArray(output.loaded)) return null;
  const names = output.loaded.filter((name): name is string => typeof name === 'string');
  const labels = Array.isArray(output.labels) ? output.labels : [];
  return { names, labels: names.map((name, index) => typeof labels[index] === 'string' ? labels[index] : name) };
}

export interface AgentPlanDraft { plan: string; approved: boolean | null; feedback: string | null }

/** 计划模式的提交：模型写的 Markdown 计划，以及用户批准、要求修改（可带意见）的结果。 */
export function getAgentPlan(tool: AgentToolPart): AgentPlanDraft | null {
  if (tool.name !== AGENT_SUBMIT_PLAN_TOOL) return null;
  const input = record(tool.input);
  if (typeof input.plan !== 'string' || !input.plan.trim()) return null;
  const output = record(tool.output);
  return {
    plan: input.plan,
    approved: typeof output.approved === 'boolean' ? output.approved : null,
    feedback: typeof output.feedback === 'string' && output.feedback.trim() ? output.feedback.trim() : null,
  };
}

export function getAgentProfile(tool: AgentToolPart) {
  if (tool.status !== 'completed' || tool.name !== 'read_user_profile') return null;
  const output = record(tool.output);
  const profile = record(output.profile);
  return {
    identity: typeof profile.identity === 'string' && profile.identity.trim() ? profile.identity : null,
    defaultBaziChartId: typeof output.defaultBaziChartId === 'string' ? output.defaultBaziChartId : null,
    defaultZiweiChartId: typeof output.defaultZiweiChartId === 'string' ? output.defaultZiweiChartId : null,
  };
}

/** Private attachments are read in 8000-character pages; record how far the Agent has read. */
export function getAgentAttachmentRead(tool: AgentToolPart) {
  if (tool.status !== 'completed' || tool.name !== 'read_attachment') return null;
  const output = record(tool.output);
  if (!strings(output, ['id', 'name', 'kind'])) return null;
  const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
  const text = typeof output.text === 'string' ? output.text : null;
  const offset = count(output.offset), total = count(output.total);
  return {
    id: String(output.id), name: String(output.name), kind: String(output.kind),
    offset, total, readUntil: offset !== null && text !== null ? offset + text.length : null,
    nextOffset: count(output.nextOffset), note: typeof output.note === 'string' ? output.note : null,
  };
}

export interface AgentMemoryEntry { id: string; title: string; content: string; kind: 'preference' | 'context' }

/** Memories read or written by the Agent; ownership columns of older cached results are ignored. */
export function getAgentMemories(tool: AgentToolPart): AgentMemoryEntry[] | null {
  if (tool.status !== 'completed' || !['read_user_memory', 'remember_user_fact'].includes(tool.name)) return null;
  const rows = tool.name === 'remember_user_fact' ? [tool.output] : tool.output;
  if (!Array.isArray(rows)) return null;
  return rows.flatMap(item => {
    const row = record(item);
    return strings(row, ['id', 'title', 'content']) && (row.kind === 'preference' || row.kind === 'context')
      ? [{ id: String(row.id), title: String(row.title), content: String(row.content), kind: row.kind }] : [];
  });
}

/** ask_user persists normalized questions; older calls fall back to their arguments. */
export function getAgentToolQuestions(tool: AgentToolPart): AgentQuestion[] {
  for (const source of [tool.output, tool.input]) {
    const value = record(source);
    try { return normalizeQuestions(value.questions, typeof value.question === 'string' ? value.question : undefined); } catch { /* try the next source */ }
  }
  return [];
}

