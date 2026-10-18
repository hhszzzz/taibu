import type { BaziCellJSON, BaziRelationJSON } from 'taibu-core/bazi';
import type { AgentChart, AgentToolPart } from './tool-presentation';
import { getAgentChart, getAgentToolArtifactId } from './tool-presentation';
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
  if (tool.name === 'inspect_chart' && tool.output && typeof tool.output === 'object') {
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
    add(id, palace.宫名 + ' ' + palace.宫位);
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

export function getLatestChartFocus(tools: AgentToolPart[], reference?: string): ChartFocus | null {
  const reinspected = new Set<string>();
  for (let index = tools.length - 1; index >= 0; index--) {
    const tool = tools[index], focus = getChartFocus(tool);
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
