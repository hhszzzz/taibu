import type { BaziCellJSON, BaziRelationJSON } from 'taibu-core/bazi';
import type { AgentChart, AgentToolPart } from './tool-presentation';
import { getAgentChart, getAgentToolArtifactId } from './tool-presentation';
import { getAgentDrilldownBase } from './tool-catalog';
import { parseTraditionalYaoPosition } from '@/lib/divination/liuyao-result-state';

export type ChartTarget =
  | { id: string; label: string; kind: 'bazi_cell'; cell: BaziCellJSON }
  | { id: string; label: string; kind: 'bazi_relation'; relation: BaziRelationJSON }
  | { id: string; label: string; kind: 'ziwei_palace'; palaceIndex: number }
  | { id: string; label: string; kind: 'ziwei_star'; palaceIndex: number; group: '主星及四化' | '辅星' | '杂曜'; starIndex: number }
  | { id: string; label: string; kind: 'entity'; domain: AgentChart['kind'] };

export interface ChartFocus {
  version: 1;
  reference: string;
  targetIds: string[];
  includeRelated: boolean;
  caption: string;
}

/** 追问命盘时附在输入框上方的富文本上下文：盘名、盘种与当前查看的位置。 */
export interface ChartAskContext {
  reference: string;
  title: string;
  kind: AgentChart['kind'];
  targets: ChartTarget[];
}

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const CHART_SOURCE_KINDS = { bazi_chart: 'bazi', ziwei_chart: 'ziwei', qimen_chart: 'qimen', liuyao_divination: 'liuyao', meihua_divination: 'meihua', daliuren_divination: 'daliuren', xiaoliuren_divination: 'xiaoliuren', tarot_reading: 'tarot' } as const;
export type ChartSource = keyof typeof CHART_SOURCE_KINDS;
const referencePattern = new RegExp('^(artifact|' + Object.keys(CHART_SOURCE_KINDS).join('|') + '):(' + uuid + ')$', 'i');
export function parseChartReference(value: unknown): { source: 'artifact' | ChartSource; id: string } | null {
  if (typeof value !== 'string') return null;
  const match = referencePattern.exec(value);
  return match ? { source: match[1].toLowerCase() as 'artifact' | ChartSource, id: match[2].toLowerCase() } : null;
}

export function getAgentChartReference(tool: AgentToolPart): string | null {
  // Inspections and drilldowns name the chart they read; a calculation is its own chart.
  if ((tool.name === 'inspect_chart' || getAgentDrilldownBase(tool.name)) && tool.output && typeof tool.output === 'object') {
    const reference = (tool.output as { chartReference?: unknown }).chartReference;
    const parsed = parseChartReference(reference);
    return parsed ? parsed.source + ':' + parsed.id : null;
  }
  const id = getAgentToolArtifactId(tool);
  return id && parseChartReference('artifact:' + id) ? 'artifact:' + id.toLowerCase() : null;
}

/** Coordinates come from the returned chart; natural-language relations are never parsed. */
export function getChartTargets(value: AgentChart): ChartTarget[] {
  const targets: ChartTarget[] = [];
  const add = (id: string, label: string) => targets.push({ id, label, kind: 'entity', domain: value.kind });
  if (value.kind === 'bazi') {
    const names = ['年柱', '月柱', '日柱', '时柱'] as const;
    value.chart.四柱.forEach((pillar, index) => {
      if (pillar.柱 !== names[index]) return;
      (['天干', '地支'] as const).forEach((part, offset) => {
        const char = pillar.干支.charAt(offset);
        const alphabet = offset === 0 ? '甲乙丙丁戊己庚辛壬癸' : '子丑寅卯辰巳午未申酉戌亥';
        if (!char || !alphabet.includes(char)) return;
        targets.push({ id: 'bazi:cell:' + index + ':' + offset, kind: 'bazi_cell',
          label: pillar.柱 + part + ' ' + char, cell: { 柱: names[index], 部位: part, 字: char } });
      });
    });
    for (const relation of value.chart.干支关系明细 ?? []) {
      if (!relation || typeof relation.id !== 'string' || typeof relation.说明 !== 'string' || !Array.isArray(relation.位置) || relation.位置.length < 2) continue;
      if (!relation.位置.every(cell => targets.some(target => target.kind === 'bazi_cell' && target.cell.柱 === cell?.柱 && target.cell.部位 === cell.部位 && target.cell.字 === cell.字))) continue;
      targets.push({ id: relation.id, kind: 'bazi_relation', label: relation.说明, relation });
    }
  }
  if (value.kind === 'ziwei') {
    value.chart.十二宫位.forEach(palace => {
      const branch = '子丑寅卯辰巳午未申酉戌亥'.indexOf(palace.干支.slice(-1));
      if (branch < 0) return;
      const palaceIndex = palace.宫位索引 ?? (branch + 10) % 12;
      if (!Number.isInteger(palaceIndex) || palaceIndex < 0 || palaceIndex > 11) return;
      targets.push({ id: 'ziwei:palace:' + palaceIndex, kind: 'ziwei_palace', palaceIndex, label: palace.宫位 + ' ' + palace.干支 });
      (['主星及四化', '辅星', '杂曜'] as const).forEach((group, groupIndex) => {
        (palace[group] ?? []).forEach((star, starIndex) => {
          if (!star || typeof star.星名 !== 'string') return;
          targets.push({ id: 'ziwei:star:' + palaceIndex + ':' + groupIndex + ':' + starIndex,
            kind: 'ziwei_star', palaceIndex, group, starIndex, label: palace.宫位 + ' ' + star.星名 + (star.四化 ? '（' + star.四化 + '）' : '') });
        });
      });
    });
  }
  if (value.kind === 'qimen') value.chart.九宫盘.forEach(palace => {
    const id = 'qimen:palace:' + palace.宫位序号;
    // 宫位已含宫名（坎1），标签写作「坎1宫」，不再重复宫名。
    add(id, palace.宫位 + '宫');
    if (palace.宫位序号 !== 5) for (const field of ['八神', '九星', '八门', '天盘天干', '地盘天干'] as const) {
      if (palace[field]) add(id + ':' + field, palace.宫名 + ' ' + field + ' ' + palace[field]);
    }
  });
  if (value.kind === 'liuyao') {
    add('liuyao:hexagram:base', '本卦 ' + value.chart.卦盘.本卦.卦名);
    if (value.chart.卦盘.变卦) add('liuyao:hexagram:changed', '变卦 ' + value.chart.卦盘.变卦.卦名);
    for (const key of ['互卦', '错卦', '综卦'] as const) if (value.chart.卦盘[key]) {
      add('liuyao:derived:' + key, key + ' ' + value.chart.卦盘[key]!.卦名);
      for (let position = 1; position <= 6; position++) add('liuyao:derived:' + key + ':line:' + position, key + ' 第' + position + '爻');
    }
    value.chart.六爻.forEach(line => {
      const position = parseTraditionalYaoPosition(line.爻位);
      if (!position) return;
      const id = 'liuyao:line:' + position;
      add(id, line.爻位 + ' ' + line.六亲 + ' ' + line.纳甲 + (line.世应 ? ' ' + line.世应 : ''));
      if (value.chart.卦盘.变卦) add('liuyao:changed:line:' + position, '变卦 ' + line.爻位 + (line.变爻 ? ' ' + line.变爻.六亲 + ' ' + line.变爻.纳甲 : ''));
      if (line.伏神) add(id + ':hidden', line.爻位 + '伏神 ' + line.伏神.六亲 + ' ' + line.伏神.纳甲);
    });
  }
  if (value.kind === 'meihua') {
    for (const key of ['本卦', '互卦', '变卦'] as const) {
      const hexagram = value.chart.卦盘[key];
      if (!hexagram) continue;
      add('meihua:hexagram:' + key, key + ' ' + hexagram.卦名);
      for (let position = 1; position <= 6; position++) add('meihua:hexagram:' + key + ':line:' + position, key + ' 第' + position + '爻');
    }
    for (const key of ['体卦', '用卦'] as const) if (value.chart.卦盘[key]) add('meihua:trigram:' + key, key + ' ' + value.chart.卦盘[key].卦名 + ' ' + value.chart.卦盘[key].所属);
    value.chart.阶段推演?.forEach((stage, index) => add('meihua:stage:' + index, '阶段推演 ' + (index + 1) + ' ' + stage.阶段));
    for (const key of ['错卦', '综卦'] as const) if (value.chart.卦盘.扩展参考?.[key]) {
      add('meihua:derived:' + key, key + ' ' + value.chart.卦盘.扩展参考[key]!.卦名);
      for (let position = 1; position <= 6; position++) add('meihua:derived:' + key + ':line:' + position, key + ' 第' + position + '爻');
    }
  }
  if (value.kind === 'daliuren') {
    value.chart.天地盘.forEach((palace, index) => {
      const id = 'daliuren:palace:' + index;
      add(id, '地盘' + palace.地盘 + ' 天盘' + palace.天盘);
      for (const field of ['天盘', '地盘', '天将'] as const) if (palace[field]) add(id + ':' + field, '地盘' + palace.地盘 + ' ' + field + palace[field]);
    });
    value.chart.四课.forEach((lesson, index) => add('daliuren:lesson:' + index, lesson.课别 + ' ' + lesson.上神 + ' / ' + lesson.下神));
    value.chart.三传.forEach((step, index) => add('daliuren:transmission:' + index, step.传序 + ' ' + step.地支 + ' ' + (step.天将 ?? '')));
  }
  if (value.kind === 'xiaoliuren') {
    (['月上起', '日上落', '时上落'] as const).forEach((step, index) => add('xiaoliuren:step:' + index, step + ' ' + value.chart.推演链[step]));
    add('xiaoliuren:result', '最终落宫 ' + value.chart.结果.落宫);
  }
  if (value.kind === 'tarot') value.chart.牌阵展开.forEach((card, index) => add('tarot:card:' + index, card.位置 + ' ' + card.塔罗牌 + ' ' + card.状态));
  if (value.kind === 'taiyi') {
    value.chart.九星阵列.forEach((star, index) => add('taiyi:star:' + index, star.观测层级 + ' ' + star.太乙名 + ' ' + star.宫位));
    value.chart.太乙七十二局?.十六宫.forEach((palace, index) => {
      const id = 'taiyi:palace:' + index;
      add(id, palace.宫位 + ' ' + palace.宫神);
      palace.星将.forEach((star, starIndex) => add(id + ':star:' + starIndex, palace.宫位 + ' ' + star));
    });
    if (value.chart.太乙七十二局) for (const field of ['太乙', '文昌', '始击', '计神', '合神', '太岁', '主算', '主大将', '主参将', '客算', '客大将', '客参将'] as const)
      add('taiyi:field:' + field, field + ' ' + value.chart.太乙七十二局[field]);
  }
  if (value.kind === 'astrology') {
    value.chart.本命主星.forEach((planet, index) => {
      add('astrology:natal:' + index, planet.因素 + ' ' + planet.星座 + ' ' + planet.黄经);
      planet.关键相位?.forEach((aspect, aspectIndex) => add('astrology:natal:' + index + ':aspect:' + aspectIndex, planet.因素 + ' ' + aspect.相位 + ' ' + aspect.对象));
    });
    value.chart.当前流运触发.forEach((planet, index) => add('astrology:transit:' + index, '流运 ' + planet.流运星体 + ' ' + planet.星座));
    for (const key of ['太阳', '月亮', '上升', '天顶'] as const) if (value.chart.命盘锚点[key]) add('astrology:anchor:' + key, key + ' ' + value.chart.命盘锚点[key]!.星座);
    value.chart.扩展信息?.宫位宫头?.forEach((house, index) => add('astrology:house:' + index, house.宫位 + ' ' + house.宫头星座));
    value.chart.扩展信息?.附加点与交点?.forEach((point, index) => add('astrology:point:' + index, point.因素 + ' ' + point.本命.星座));
    for (const group of ['本命', '流运'] as const) value.chart.扩展信息?.完整相位矩阵?.[group].forEach((aspect, index) =>
      add('astrology:aspect:' + group + ':' + index, group + ' ' + aspect.起点 + ' ' + aspect.相位 + ' ' + aspect.终点));
  }
  if (value.kind === 'almanac') {
    add('almanac:date', value.chart.基础与个性化坐标.日期 + ' ' + value.chart.基础与个性化坐标.日干支);
    for (const field of ['宜', '忌'] as const) add('almanac:activity:' + field, field + ' ' + value.chart.择日宜忌[field].join('、'));
    for (const field of ['吉神宜趋', '凶煞宜忌'] as const) if (value.chart.神煞参考[field]?.length) add('almanac:spirit:' + field, field + ' ' + value.chart.神煞参考[field]!.join('、'));
    if (value.chart.方位信息) for (const [field, direction] of Object.entries(value.chart.方位信息)) add('almanac:direction:' + field, field + ' ' + direction);
    if (value.chart.值日信息) for (const [field, item] of Object.entries(value.chart.值日信息)) if (item) add('almanac:day:' + field, field + ' ' + item);
    value.chart.时辰吉凶?.forEach((hour, index) => add('almanac:hour:' + index, hour.时辰 + ' ' + (hour.天神吉凶 ?? '')));
  }
  return targets;
}

/** 详查结果里每行的「位置」；结构与 Core 的干支关系明细一致。 */
type DrilldownCell = { 柱?: unknown; 部位?: unknown; 字?: unknown };

/** 同字牵连只是提示「共用同一个字」，不是这次查询的事实；盘面只点亮查到的那些字。 */
function drilldownCells(value: unknown, cells: DrilldownCell[] = [], depth = 0): DrilldownCell[] {
  if (depth > 4 || !value || typeof value !== 'object') return cells;
  if (Array.isArray(value)) {
    for (const item of value) drilldownCells(item, cells, depth + 1);
    return cells;
  }
  const row = value as Record<string, unknown>;
  if (Array.isArray(row.位置)) cells.push(...row.位置.filter((cell): cell is DrilldownCell => !!cell && typeof cell === 'object'));
  for (const [key, child] of Object.entries(row)) if (key !== '位置' && key !== '计算规则' && key !== '同字牵连') drilldownCells(child, cells, depth + 1);
  return cells;
}

/**
 * The chart's own targets a drilldown result touches, at most 16. Positions outside the
 * board (大运、流年…) have no target. A focus call may pass them unchanged.
 */
export function getDrilldownTargets(value: AgentChart, result: unknown): ChartTarget[] {
  const targets = getChartTargets(value);
  const byId = new Map(targets.map(target => [target.id, target]));
  const ids = value.kind === 'bazi' ? baziDrilldownTargetIds(targets, result) : structuredDrilldownTargetIds(value.kind, targets, result);
  return [...new Set(ids)].map(id => byId.get(id)).filter((target): target is ChartTarget => target !== undefined).slice(0, 16);
}

/**
 * 八字详查（岁运刑冲合害、五行、流年扫描）触及的原局字块。岁运叠加的关系都含大运、流年等盘外的柱，
 * 原局之间的关系由命盘自己给出，所以详查只点亮它碰到的原局字；详查完成后盘面直接显示，不需要模型再补一次 focus_chart。
 */
function baziDrilldownTargetIds(targets: ChartTarget[], result: unknown): string[] {
  const cells = drilldownCells(result);
  return targets.flatMap(target => target.kind === 'bazi_cell'
    && cells.some(cell => cell.柱 === target.cell.柱 && cell.部位 === target.cell.部位 && cell.字 === target.cell.字) ? [target.id] : []);
}

/** 递归访问详查结果里的每个对象；只读取 Core 输出里的结构化字段，不解析自然语言。 */
function walkFactNodes(value: unknown, visit: (node: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 6 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walkFactNodes(item, visit, depth + 1);
    return;
  }
  const node = value as Record<string, unknown>;
  visit(node);
  for (const [key, child] of Object.entries(node)) if (key !== '计算规则' && key !== '口径') walkFactNodes(child, visit, depth + 1);
}

const QIMEN_FIELD_PARTS: readonly string[] = ['八神', '九星', '八门', '天盘天干', '地盘天干'];

type PushTarget = (id: string | undefined) => void;

/** 各盘种详查结果里的位置结构到盘面目标 id 的映射；id 都来自 getChartTargets，找不到的丢弃。 */
function structuredDrilldownTargetIds(kind: AgentChart['kind'], targets: ChartTarget[], result: unknown): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push: PushTarget = id => { if (id && !seen.has(id)) { seen.add(id); ids.push(id); } };
  const visit = kind === 'ziwei' ? ziweiTargetVisitor(targets, push)
    : kind === 'qimen' ? qimenTargetVisitor(push)
      : kind === 'daliuren' ? daliurenTargetVisitor(targets, push)
        : kind === 'astrology' ? astrologyTargetVisitor(targets, push)
          : kind === 'liuyao' ? liuyaoTargetVisitor(push)
            : null;
  if (visit) walkFactNodes(result, visit);
  return ids;
}

/** 紫微：宫位名还原成本命宫位；星曜（含四化飞出的落星）还原到本命所在宫位的那颗星。 */
function ziweiTargetVisitor(targets: ChartTarget[], push: PushTarget) {
  const palaces = targets.filter((target): target is Extract<ChartTarget, { kind: 'ziwei_palace' }> => target.kind === 'ziwei_palace');
  const stars = targets.filter((target): target is Extract<ChartTarget, { kind: 'ziwei_star' }> => target.kind === 'ziwei_star');
  const palaceByName = new Map(palaces.map(target => [target.label.split(' ')[0], target]));
  return (node: Record<string, unknown>) => {
    for (const key of ['宫位', '对宫', '落入本命宫位'] as const) {
      const name = node[key];
      if (typeof name === 'string') push(palaceByName.get(name)?.id);
    }
    const starName = typeof node.星曜 === 'string' ? node.星曜
      : typeof node.类型 === 'string' && node.类型.startsWith('化') && typeof node.结果 === 'string' ? node.结果 : undefined;
    if (!starName) return;
    const cells = Array.isArray(node.位置) ? node.位置 : [];
    const last = cells.at(-1);
    const palaceName = last && typeof last === 'object' ? (last as { 宫位?: unknown }).宫位 : undefined;
    const palace = typeof palaceName === 'string' ? palaceByName.get(palaceName) : undefined;
    if (!palace) return;
    push(stars.find(target => target.palaceIndex === palace.palaceIndex
      && (target.label === palace.label + ' ' + starName || target.label.startsWith(palace.label + ' ' + starName + '（')))?.id);
  };
}

/** 奇门：宫位序号直接给出宫与部位；宫名字符串（含同见宫位、中宫寄宫、值符值使落宫）取卦名与序号。 */
function qimenTargetVisitor(push: PushTarget) {
  const palaceId = (number: number) => 'qimen:palace:' + number;
  const pushName = (text: unknown) => {
    const match = typeof text === 'string' ? /[坎坤震巽中乾兑艮]([1-9])/u.exec(text.trim()) : null;
    if (match) push(palaceId(Number(match[1])));
  };
  return (node: Record<string, unknown>) => {
    const number = node.宫位序号;
    if (typeof number === 'number' && Number.isInteger(number) && number >= 1 && number <= 9) {
      push(palaceId(number));
      const part = node.部位;
      if (typeof part === 'string' && QIMEN_FIELD_PARTS.includes(part)) push(palaceId(number) + ':' + part);
    }
    pushName(node.宫位);
    if (Array.isArray(node.同见宫位)) node.同见宫位.forEach(pushName);
    if (Array.isArray(node.中宫寄宫)) node.中宫寄宫.forEach(pushName);
    const leaders = node.值符值使;
    if (leaders && typeof leaders === 'object') for (const text of Object.values(leaders as Record<string, unknown>)) pushName(text);
  };
}

/** 大六壬：课别、传序按盘面标签对齐；地盘支还原到天地盘宫位，部位再取该宫的字段目标。 */
function daliurenTargetVisitor(targets: ChartTarget[], push: PushTarget) {
  const lessons = targets.filter(target => target.id.startsWith('daliuren:lesson:'));
  const transmissions = targets.filter(target => target.id.startsWith('daliuren:transmission:'));
  const palaceByBranch = new Map<string, string>();
  const fieldIds = new Set<string>();
  for (const target of targets) {
    if (/^daliuren:palace:\d+$/u.test(target.id) && target.label.startsWith('地盘')) palaceByBranch.set(target.label.charAt(2), target.id);
    if (/^daliuren:palace:\d+:(天盘|地盘|天将)$/u.test(target.id)) fieldIds.add(target.id);
  }
  return (node: Record<string, unknown>) => {
    const cells = Array.isArray(node.位置) ? node.位置 : [];
    for (const cell of cells) {
      if (!cell || typeof cell !== 'object') continue;
      const item = cell as Record<string, unknown>;
      const ke = item.课别, chuan = item.传序, di = item.地盘, part = item.部位;
      if (typeof ke === 'string') push(lessons.find(target => target.label.startsWith(ke + ' '))?.id);
      if (typeof chuan === 'string') push(transmissions.find(target => target.label.startsWith(chuan + ' '))?.id);
      if (typeof di === 'string') {
        const base = palaceByBranch.get(di);
        if (base) {
          push(base);
          if (part === '天盘' || part === '天将') push(fieldIds.has(base + ':' + part) ? base + ':' + part : undefined);
        }
      }
    }
  };
}

/** 占星：位置格按盘面（本命/流运）与因素名对齐星体、附加点目标；宫位信息还原到宫位目标。 */
function astrologyTargetVisitor(targets: ChartTarget[], push: PushTarget) {
  const natalByName = new Map<string, string>();
  const pointByName = new Map<string, string>();
  const transitByName = new Map<string, string>();
  const houseIds = new Map<number, string>();
  for (const target of targets) {
    if (/^astrology:natal:\d+$/u.test(target.id)) natalByName.set(target.label.split(' ')[0], target.id);
    if (/^astrology:point:\d+$/u.test(target.id)) pointByName.set(target.label.split(' ')[0], target.id);
    if (/^astrology:transit:\d+$/u.test(target.id)) transitByName.set(target.label.replace(/^流运 /u, '').split(' ')[0], target.id);
    const house = /^astrology:house:(\d+)$/u.exec(target.id);
    if (house) houseIds.set(Number(house[1]) + 1, target.id);
  }
  return (node: Record<string, unknown>) => {
    const cells = Array.isArray(node.位置) ? node.位置 : [];
    for (const cell of cells) {
      if (!cell || typeof cell !== 'object') continue;
      const item = cell as { 盘?: unknown; 因素?: unknown };
      const board = item.盘, factor = item.因素;
      if (typeof factor !== 'string') continue;
      if (board === '本命') push(natalByName.get(factor) ?? pointByName.get(factor));
      if (board === '流运') push(transitByName.get(factor));
    }
    const house = node.宫位信息;
    if (house && typeof house === 'object') {
      const number = (house as { 宫位序号?: unknown }).宫位序号;
      if (typeof number === 'number') push(houseIds.get(number));
    }
  };
}

/** 六爻：爻序号直接还原本爻或变爻目标。 */
function liuyaoTargetVisitor(push: PushTarget) {
  return (node: Record<string, unknown>) => {
    const cells = Array.isArray(node.位置) ? node.位置 : [];
    for (const cell of cells) {
      if (!cell || typeof cell !== 'object') continue;
      const item = cell as { 序号?: unknown; 部位?: unknown };
      const position = item.序号, part = item.部位;
      if (typeof position !== 'number' || !Number.isInteger(position)) continue;
      push((part === '变爻' ? 'liuyao:changed:line:' : 'liuyao:line:') + position);
    }
  };
}

export function validateChartFocus(value: AgentChart, reference: string, ids: string[], includeRelated: boolean, caption: string): ChartFocus {
  if (!parseChartReference(reference)) throw new Error('命盘引用格式不正确');
  if (ids.length > 16 || caption.length > 160) throw new Error('命盘定位内容过长');
  const targets = new Set(getChartTargets(value).map(target => target.id));
  if (ids.some(id => !targets.has(id))) throw new Error('定位目标不在这张命盘中，请先查看命盘目标目录');
  return { version: 1, reference, targetIds: [...new Set(ids)], includeRelated, caption };
}

export function getChartFocus(tool: AgentToolPart): ChartFocus | null {
  if (tool.name !== 'focus_chart' || tool.status !== 'completed' || !tool.output || typeof tool.output !== 'object') return null;
  const focus = (tool.output as { chartFocus?: ChartFocus }).chartFocus;
  if (!focus || focus.version !== 1 || !parseChartReference(focus.reference) || !Array.isArray(focus.targetIds) ||
    focus.targetIds.length > 16 || !focus.targetIds.every(id => typeof id === 'string') ||
    typeof focus.caption !== 'string' || focus.caption.length > 160 || typeof focus.includeRelated !== 'boolean') return null;
  return focus;
}

/**
 * A completed drilldown as a focus: its targets on the chart it read, captioned
 * by the drilldown title. The workspace pins it when the reader asks to locate it.
 */
export function getDrilldownFocus(tool: AgentToolPart): ChartFocus | null {
  if (!getAgentDrilldownBase(tool.name) || tool.status !== 'completed' || !tool.output || typeof tool.output !== 'object') return null;
  const output = tool.output as { chartReference?: unknown; targets?: unknown };
  const reference = parseChartReference(output.chartReference);
  if (!reference || !Array.isArray(output.targets)) return null;
  const targetIds = output.targets.flatMap(target => target && typeof (target as { id?: unknown }).id === 'string' ? [(target as { id: string }).id] : []).slice(0, 16);
  return { version: 1, reference: reference.source + ':' + reference.id, targetIds, includeRelated: false, caption: tool.title.slice(0, 160) };
}

/** One resource per reading, including reinspection in a later task. */
export function getChartResources(tools: AgentToolPart[]) {
  const resources = new Map<string, { tool: AgentToolPart; value: AgentChart; reference: string | null }>();
  for (const tool of tools) {
    const value = getAgentChart(tool);
    if (!value) continue;
    const reference = getAgentChartReference(tool);
    resources.set(reference ?? tool.id, { tool, value, reference });
  }
  return [...resources.values()];
}

/** Keep the calculation card; repeated inspection updates its workspace without another inline chart. */
export function deduplicateChartResults(tools: AgentToolPart[]): AgentToolPart[] {
  const calculations = new Set(tools.filter(tool => tool.name !== 'inspect_chart' && getAgentChart(tool)).map(getAgentChartReference));
  const latest = new Map(getChartResources(tools).map(resource => [resource.reference, resource.tool.id]));
  return tools.filter(tool => {
    if (tool.name !== 'inspect_chart' || !getAgentChart(tool)) return true;
    const reference = getAgentChartReference(tool);
    return !reference || (!calculations.has(reference) && latest.get(reference) === tool.id);
  });
}

/**
 * What a drilldown or inspection shows the model looking at: a completed drilldown, the
 * positions its result touches; while either runs, the chart named in its arguments with
 * no positions yet. A failed call looked at nothing.
 */
function getDrilldownViewFocus(tool: AgentToolPart): ChartFocus | null {
  const drilldown = getAgentDrilldownBase(tool.name) !== null;
  if (!drilldown && tool.name !== 'inspect_chart') return null;
  if (drilldown && tool.status === 'completed') return getDrilldownFocus(tool);
  if (tool.status !== 'pending' && tool.status !== 'running') return null;
  // A running inspection reads the whole chart; once done it clears old coordinates (see below).
  const input = tool.input && typeof tool.input === 'object' ? (tool.input as { reference?: unknown }).reference : undefined;
  const reference = parseChartReference(input);
  const caption = drilldown ? '详查中 · ' + tool.title : '读取整张盘';
  return reference ? { version: 1, reference: reference.source + ':' + reference.id, targetIds: [], includeRelated: false, caption: caption.slice(0, 160) } : null;
}

/** The model's latest view of a chart: a focus call, or the drilldown it ran after it. */
export function getLatestChartFocus(tools: AgentToolPart[], reference?: string): ChartFocus | null {
  const reinspected = new Set<string>();
  for (let index = tools.length - 1; index >= 0; index--) {
    const tool = tools[index], focus = getChartFocus(tool) ?? getDrilldownViewFocus(tool);
    if (focus && !reinspected.has(focus.reference) && (!reference || focus.reference === reference)) return focus;
    // A fresh inspection may contain edited saved data; previous coordinates and captions no longer apply.
    if (tool.name === 'inspect_chart' && tool.status === 'completed') {
      const inspected = getAgentChartReference(tool);
      if (inspected) reinspected.add(inspected);
    }
  }
  return null;
}

export function chartQuestion(reference: string, targets: ChartTarget[]) {
  if (!parseChartReference(reference)) throw new Error('命盘引用格式不正确');
  return '请继续分析这张命盘的' + (targets.map(target => target.label).join('、') || '整体情况') +
    '。命盘引用：' + reference + '。请先查看原盘，并在命盘中标出当前分析位置。';
}
