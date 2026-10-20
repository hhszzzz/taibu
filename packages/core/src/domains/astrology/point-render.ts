import { withRulesJSON } from '../../shared/calculation-rules.js';
import { drilldownText } from '../shared/drilldown-render.js';
import type { AstrologyPointAspect, AstrologyPointOutput, AstrologyPointPlacement, AstrologyPointRef } from './point.js';

export interface AstrologyPointCellJSON { 盘: '本命' | '流运'; 标识: string; 因素: string; }

export interface AstrologyPointPlacementJSON {
  因素: string;
  标识: string;
  星座: string;
  元素: string;
  模式: string;
  黄经: string;
  宫位?: string;
  逆行?: '是' | '否';
  位置: AstrologyPointCellJSON[];
}

export interface AstrologyPointAspectJSON {
  类型: string;
  位置: AstrologyPointCellJSON[];
  容许度: number;
  实际夹角: number;
  相态?: '入相' | '出相';
  说明: string;
}

export interface AstrologyPointCanonicalJSON {
  /** 范围只在只看本命或只看流运时给出 */
  查询: { 对象: string; 类型: '星体' | '宫位'; 范围?: '本命' | '流运' };
  位置信息?: AstrologyPointPlacementJSON;
  传统尊贵?: string[];
  主管宫位?: string[];
  宫位信息?: { 宫位: string; 宫位序号: number; 宫头星座: string; 宫头黄经: string; 宫尾黄经: string; 跨度: number };
  宫内星体?: AstrologyPointPlacementJSON[];
  宫主星?: AstrologyPointPlacementJSON & { 传统尊贵: string[] };
  本命相位?: AstrologyPointAspectJSON[];
  宫主星相位?: AstrologyPointAspectJSON[];
  流运触发?: AstrologyPointAspectJSON[];
  流运过境?: AstrologyPointPlacementJSON[];
  口径: string[];
}

const NOTES = [
  '只列盘面事实，不判断吉凶',
  '传统尊贵取托勒密体系的守护与擢升（入庙、擢升、失势、落陷），只对日月与五颗古典行星给出；不计三分性、界与面，现代行星不计传统尊贵',
  '宫主星取宫头星座的传统守护星，不用现代守护（天王、海王、冥王）',
  '入相、出相按一小时后的容许度增减判断；交点、莉莉丝与轴点不计速度，相关相位不标相态；流运对本命时本命端视为不动',
  '流运过境取流运星体黄经落在本命宫头之间的情形',
  'focus 为本命时不列流运；为流运时只列流运触发或流运过境，并附所查对象的本命位置或宫位范围作参照',
];

const cell = (ref: AstrologyPointRef): AstrologyPointCellJSON => ({ 盘: ref.chart, 标识: ref.key, 因素: ref.label });

function placementJSON(item: AstrologyPointPlacement): AstrologyPointPlacementJSON {
  return {
    因素: item.ref.label,
    标识: item.ref.key,
    星座: item.sign,
    元素: item.element,
    模式: item.modality,
    黄经: item.position,
    ...(item.house !== undefined ? { 宫位: `第${item.house}宫` } : {}),
    ...(item.retrograde !== undefined ? { 逆行: item.retrograde ? '是' as const : '否' as const } : {}),
    位置: [cell(item.ref)],
  };
}

function aspectJSON(item: AstrologyPointAspect): AstrologyPointAspectJSON {
  const head = `${item.from.chart}${item.from.label}${item.type}${item.to.chart}${item.to.label}`;
  return {
    类型: item.type,
    位置: [cell(item.from), cell(item.to)],
    容许度: item.orb,
    实际夹角: item.angle,
    ...(item.phase ? { 相态: item.phase } : {}),
    说明: `${head}（容许度 ${item.orb}°${item.phase ? `，${item.phase}` : ''}）`,
  };
}

function renderAstrologyPointJSONBase(result: AstrologyPointOutput): AstrologyPointCanonicalJSON {
  const isPlanet = result.query.kind === 'planet';
  const focus = result.query.focus;
  return {
    查询: { 对象: result.query.label, 类型: isPlanet ? '星体' : '宫位', ...(focus !== '全部' ? { 范围: focus } : {}) },
    ...(result.placement ? { 位置信息: placementJSON(result.placement) } : {}),
    ...(result.dignities ? { 传统尊贵: result.dignities.length ? [...result.dignities] : ['无'] } : {}),
    ...(result.ruledHouses ? { 主管宫位: result.ruledHouses.map((id) => `第${id}宫`) } : {}),
    ...(result.house ? {
      宫位信息: {
        宫位: `第${result.house.id}宫`, 宫位序号: result.house.id, 宫头星座: result.house.sign,
        宫头黄经: result.house.start, 宫尾黄经: result.house.end, 跨度: result.house.span,
      },
    } : {}),
    ...(result.occupants ? { 宫内星体: result.occupants.map(placementJSON) } : {}),
    ...(result.ruler ? { 宫主星: { ...placementJSON(result.ruler), 传统尊贵: result.ruler.dignities.length ? [...result.ruler.dignities] : ['无'] } } : {}),
    ...(result.aspects ? (isPlanet ? { 本命相位: result.aspects.map(aspectJSON) } : { 宫主星相位: result.aspects.map(aspectJSON) }) : {}),
    ...(result.transitAspects ? { 流运触发: result.transitAspects.map(aspectJSON) } : {}),
    ...(result.transitOccupants ? { 流运过境: result.transitOccupants.map(placementJSON) } : {}),
    口径: NOTES,
  };
}

function placementLine(item: AstrologyPointPlacementJSON): string {
  return `- ${item.因素}｜${item.星座} ${item.黄经}｜${[item.宫位, item.逆行 === '是' ? '逆行' : ''].filter(Boolean).join('，') || '-'}`;
}

function aspectLines(rows: AstrologyPointAspectJSON[]): string[] {
  return rows.length ? rows.map((row) => `- ${row.类型}｜${row.位置.map((item) => `${item.盘}${item.因素}`).join('·')}｜容许度 ${row.容许度}°${row.相态 ? `，${row.相态}` : ''}`) : ['- 无'];
}

function renderAstrologyPointTextBase(result: AstrologyPointOutput): string {
  const json = renderAstrologyPointJSONBase(result);
  const lines = ['# 占星单点详查', '', '## 查询', '', `- ${json.查询.类型}：${json.查询.对象}${json.查询.范围 ? `（只看${json.查询.范围}）` : ''}`];
  if (json.位置信息) {
    const item = json.位置信息;
    lines.push('', '## 位置信息', '', `- 星座：${item.星座}（${item.元素}象，${item.模式}）`, `- 黄经：${item.黄经}`);
    if (item.宫位) lines.push(`- 宫位：${item.宫位}`);
    if (item.逆行) lines.push(`- 逆行：${item.逆行}`);
  }
  if (json.传统尊贵) lines.push('', '## 传统尊贵', '', `- ${json.传统尊贵.join('、')}`);
  if (json.主管宫位) lines.push('', '## 主管宫位', '', `- ${json.主管宫位.join('、') || '无'}`);
  if (json.宫位信息) {
    const item = json.宫位信息;
    lines.push('', '## 宫位信息', '', `- 宫头：${item.宫头星座} ${item.宫头黄经}`, `- 宫尾：${item.宫尾黄经}`, `- 跨度：${item.跨度}°`);
  }
  if (json.宫内星体) lines.push('', '## 宫内星体', '', ...(json.宫内星体.length ? json.宫内星体.map(placementLine) : ['- 无']));
  if (json.宫主星) lines.push('', '## 宫主星', '', placementLine(json.宫主星), `- 传统尊贵：${json.宫主星.传统尊贵.join('、')}`);
  if (json.本命相位) lines.push('', '## 本命相位', '', ...aspectLines(json.本命相位));
  if (json.宫主星相位) lines.push('', '## 宫主星相位', '', ...aspectLines(json.宫主星相位));
  if (json.流运触发) lines.push('', '## 流运触发', '', ...aspectLines(json.流运触发));
  if (json.流运过境) lines.push('', '## 流运过境', '', ...(json.流运过境.length ? json.流运过境.map(placementLine) : ['- 无']));
  return lines.join('\n');
}

export const toAstrologyPointJson = withRulesJSON(renderAstrologyPointJSONBase);
export const toAstrologyPointText = drilldownText(NOTES, renderAstrologyPointTextBase);
