/**
 * 奇门宫位详查：取盘中一宫（指定宫位，或按柱干、星、门、神定位），列出天地盘、
 * 星门神、状态、旺衰、生克、值符值使与格局。只读排盘结果，不另立判断。
 */

import { GAN_WUXING } from '../../data/ganzhi.js';
import { getElementRelation } from '../../shared/utils.js';
import { CoreInputError, assertInteger } from '../../shared/validation.js';
import { buildQimenPalaceStatusList } from './json.js';
import { QIMEN_HIDDEN_JIA } from './rules.js';
import type { QimenInput, QimenOutput, QimenPalaceInfo } from './types.js';

export const QIMEN_PALACE_RULE_VERSION = 'qimen-palace-2026.10';

export const QIMEN_LOCATE_TYPES = ['年干', '月干', '日干', '时干', '星', '门', '神'] as const;
export type QimenLocateType = typeof QIMEN_LOCATE_TYPES[number];

export interface QimenPalaceSelector {
  /** 宫位序号 1–9（坎1 坤2 震3 巽4 中5 乾6 兑7 艮8 离9） */
  palace?: number;
  /** 按柱干（取天盘，甲取所遁六仪）或星、门、神定位 */
  locate?: { type: QimenLocateType; value?: string };
}

/** 宫位上的盘面部位，与网页盘面目标的字段同名 */
export type QimenBoardPart = '九星' | '八门' | '八神' | '天盘天干' | '地盘天干';

export interface QimenPositionJSON {
  宫位序号: number;
  部位?: QimenBoardPart;
}

export interface QimenFactRowJSON {
  类型: string;
  位置: QimenPositionJSON[];
  结果?: string;
  说明: string;
}

export interface QimenPalaceSections {
  查询: { 方式: string; 宫位: string; 定位?: string; 同见宫位?: string[] };
  宫位: { 宫名: string; 宫位序号: number; 宫位: string; 方位: string; 宫位五行: string; 宫旺衰?: string };
  天地盘: {
    天盘天干: string; 天盘天干五行?: string; 天盘天干旺衰?: string;
    地盘天干: string; 地盘天干五行?: string; 地盘天干旺衰?: string;
    寄天盘干?: string[]; 寄地盘干?: string[];
  };
  星门神: { 九星: string; 九星五行?: string; 寄星?: string[]; 八门: string; 八门五行?: string; 八神: string };
  中宫寄宫?: string[];
  状态: string[];
  柱干落宫: QimenFactRowJSON[];
  遁甲: string[];
  生克: QimenFactRowJSON[];
  值符值使: { 值符: string; 值使: string; 本宫?: string };
  格局: string[];
}

export interface QimenPalaceOutput {
  sections: QimenPalaceSections;
  calculationOptions: Record<string, unknown> & { ruleVersion: string };
}

const PILLAR_KEYS: Record<'年干' | '月干' | '日干' | '时干', keyof QimenOutput['siZhu']> = {
  年干: 'year', 月干: 'month', 日干: 'day', 时干: 'hour',
};

/** 柱干上盘：甲不上盘，取本柱所遁六仪（与排盘格局的口径一致） */
function boardStem(pillar: string): string {
  return pillar.startsWith('甲') ? QIMEN_HIDDEN_JIA[pillar] ?? '' : pillar.charAt(0);
}

const palaceRef = (palace: QimenPalaceInfo) => `${palace.palaceName}${palace.palaceIndex}`;
const heavenStems = (palace: QimenPalaceInfo) => [palace.heavenStem, ...(palace.hostedHeavenStems ?? [])].filter(Boolean);
const earthStems = (palace: QimenPalaceInfo) => [palace.earthStem, ...(palace.hostedEarthStems ?? [])].filter(Boolean);
const stars = (palace: QimenPalaceInfo) => [palace.star, ...(palace.hostedStars ?? [])].filter(Boolean);
/** 盘中写作「螣蛇」，也接受常见写法「腾蛇」 */
const normalizeDeity = (name: string) => name.replace('腾蛇', '螣蛇');

function validateSelector(selector: QimenPalaceSelector): void {
  if ((selector.palace === undefined) === (selector.locate === undefined)) {
    throw new CoreInputError('palace/locate', '必须且只能提供 palace 或 locate 其中之一');
  }
  if (selector.palace !== undefined) assertInteger(selector.palace, 'palace', 1, 9);
  if (selector.locate) {
    const { type, value } = selector.locate;
    if (!QIMEN_LOCATE_TYPES.includes(type)) throw new CoreInputError('locate.type', `须为 ${QIMEN_LOCATE_TYPES.join('/')}`);
    const byPillar = type in PILLAR_KEYS;
    if (byPillar && value !== undefined) throw new CoreInputError('locate.value', '按柱干定位时不需要 value');
    if (!byPillar && (typeof value !== 'string' || !value.trim())) throw new CoreInputError('locate.value', `按${type}定位时必须给出名称`);
  }
}

/** 定位：返回首个命中宫与全部命中宫；柱干先找天盘（含寄干），天盘无则找地盘 */
function locatePalaces(chart: QimenOutput, locate: NonNullable<QimenPalaceSelector['locate']>) {
  const { type } = locate;
  const value = locate.value?.trim() ?? '';
  if (type in PILLAR_KEYS) {
    const pillar = chart.siZhu[PILLAR_KEYS[type as keyof typeof PILLAR_KEYS]];
    const stem = boardStem(pillar);
    const onHeaven = chart.palaces.filter(palace => heavenStems(palace).includes(stem));
    const hits = onHeaven.length ? onHeaven : chart.palaces.filter(palace => earthStems(palace).includes(stem));
    const plate = onHeaven.length ? '天盘' : '地盘';
    const hidden = pillar.startsWith('甲') ? `（${pillar}遁于${stem}）` : '';
    return { hits, note: `${type}${pillar.charAt(0)}${hidden}临${plate}${stem}`, part: (onHeaven.length ? '天盘天干' : '地盘天干') as QimenBoardPart };
  }
  if (type === '星') {
    const name = value.endsWith('星') ? value : `${value}星`;
    return { hits: chart.palaces.filter(palace => stars(palace).includes(name)), note: `九星${name}`, part: '九星' as QimenBoardPart };
  }
  if (type === '门') {
    const name = value.endsWith('门') ? value : `${value}门`;
    return { hits: chart.palaces.filter(palace => palace.gate === name), note: `八门${name}`, part: '八门' as QimenBoardPart };
  }
  const name = normalizeDeity(value);
  return { hits: chart.palaces.filter(palace => normalizeDeity(palace.deity) === name), note: `八神${name}`, part: '八神' as QimenBoardPart };
}

type Party = { short: string; label: string; element: string };

/** 两方五行生克：结果用简称（门生宫、宫克星、天盘干克地盘干…），说明写全名与五行 */
function relation(a: Party, b: Party): { result: string; text: string } | null {
  if (!a.element || !b.element || !a.label || !b.label) return null;
  const head = `${a.label}(${a.element})`, tail = `${b.label}(${b.element})`;
  switch (getElementRelation(a.element, b.element)) {
    case 'same': return { result: '比和', text: `${head}与${tail}比和` };
    case 'produce': return { result: `${a.short}生${b.short}`, text: `${head}生${tail}` };
    case 'produced': return { result: `${b.short}生${a.short}`, text: `${tail}生${head}` };
    case 'control': return { result: `${a.short}克${b.short}`, text: `${head}克${tail}` };
    default: return { result: `${b.short}克${a.short}`, text: `${tail}克${head}` };
  }
}

export function deriveQimenPalace(chart: QimenOutput, selector: QimenPalaceSelector, _baseInput: QimenInput): QimenPalaceOutput {
  validateSelector(selector);
  const fei = chart.panType === '飞盘' || chart.panType === 'fei';
  let target: QimenPalaceInfo;
  const query: QimenPalaceSections['查询'] = { 方式: '指定宫位', 宫位: '' };
  if (selector.locate) {
    const located = locatePalaces(chart, selector.locate);
    if (!located.hits.length) throw new CoreInputError('locate', `${located.note}不在本盘中`);
    target = located.hits[0];
    query.方式 = `按${selector.locate.type}定位`;
    query.定位 = located.note;
    if (located.hits.length > 1) query.同见宫位 = located.hits.slice(1).map(palaceRef);
  } else {
    target = chart.palaces[selector.palace! - 1];
  }
  query.宫位 = palaceRef(target);

  const index = target.palaceIndex;
  const phase = chart.monthPhase ?? {};
  const centerOnTurningBoard = index === 5 && !fei;
  const sections: QimenPalaceSections = {
    查询: query,
    宫位: {
      宫名: target.palaceName, 宫位序号: index, 宫位: palaceRef(target), 方位: target.direction, 宫位五行: target.element,
      ...(target.elementState ? { 宫旺衰: target.elementState } : {}),
    },
    天地盘: {
      天盘天干: target.heavenStem || '-',
      ...(target.heavenStem ? { 天盘天干五行: GAN_WUXING[target.heavenStem], 天盘天干旺衰: target.stemWangShuai ?? phase[target.heavenStem] } : {}),
      地盘天干: target.earthStem || '-',
      ...(target.earthStem ? { 地盘天干五行: GAN_WUXING[target.earthStem], ...(phase[target.earthStem] ? { 地盘天干旺衰: phase[target.earthStem] } : {}) } : {}),
      ...(target.hostedHeavenStems?.length ? { 寄天盘干: [...target.hostedHeavenStems] } : {}),
      ...(target.hostedEarthStems?.length ? { 寄地盘干: [...target.hostedEarthStems] } : {}),
    },
    星门神: {
      九星: target.star || '-', ...(target.starElement ? { 九星五行: target.starElement } : {}),
      ...(target.hostedStars?.length ? { 寄星: [...target.hostedStars] } : {}),
      八门: target.gate || '-', ...(target.gateElement ? { 八门五行: target.gateElement } : {}),
      八神: target.deity || '-',
    },
    状态: buildQimenPalaceStatusList(target, new Set(chart.kongWang.dayKong.palaces), new Set(chart.kongWang.hourKong.palaces), chart.panType),
    柱干落宫: [],
    遁甲: [],
    生克: [],
    值符值使: {
      值符: `${chart.zhiFu.star} 落${palaceRef(chart.palaces[chart.zhiFu.palace - 1])}`,
      值使: `${chart.zhiShi.gate} 落${palaceRef(chart.palaces[chart.zhiShi.palace - 1])}`,
    },
    格局: [
      ...(chart.boardFormations ?? []).map(name => `全盘: ${name}`),
      ...target.formations.filter(name => !(chart.boardFormations ?? []).includes(name)),
    ],
  };
  const roles = [chart.zhiFu.palace === index ? '值符宫' : '', chart.zhiShi.palace === index ? '值使宫' : ''].filter(Boolean);
  if (roles.length) sections.值符值使.本宫 = roles.join('、');

  // 转盘中五不上星门：地盘干寄于天禽所随之宫，天禽随某星同落
  if (centerOnTurningBoard) {
    const hosts: string[] = [];
    for (const palace of chart.palaces) {
      if (palace.hostedEarthStems?.includes(target.earthStem)) hosts.push(`中五地盘${target.earthStem}寄${palaceRef(palace)}`);
      if (palace.hostedStars?.includes('天禽星')) hosts.push(`天禽星随${palace.star}落${palaceRef(palace)}${palace.hostedHeavenStems?.length ? `，带天盘${palace.hostedHeavenStems.join('、')}` : ''}`);
    }
    sections.中宫寄宫 = hosts;
  }

  for (const key of Object.keys(PILLAR_KEYS) as Array<keyof typeof PILLAR_KEYS>) {
    const pillar = chart.siZhu[PILLAR_KEYS[key]];
    const stem = boardStem(pillar);
    const hidden = pillar.startsWith('甲') ? `（${pillar}遁于${stem}）` : '';
    if (heavenStems(target).includes(stem)) {
      sections.柱干落宫.push({ 类型: key, 位置: [{ 宫位序号: index, 部位: '天盘天干' }], 结果: stem, 说明: `${key}${pillar.charAt(0)}${hidden}临本宫天盘` });
    }
    if (earthStems(target).includes(stem)) {
      sections.柱干落宫.push({ 类型: key, 位置: [{ 宫位序号: index, 部位: '地盘天干' }], 结果: stem, 说明: `${key}${pillar.charAt(0)}${hidden}临本宫地盘` });
    }
  }

  const hiddenJia = QIMEN_HIDDEN_JIA[chart.xunShou];
  if (hiddenJia && heavenStems(target).includes(hiddenJia)) sections.遁甲.push(`时旬首${chart.xunShou}遁于${hiddenJia}，本宫天盘见${hiddenJia}`);
  if (hiddenJia && earthStems(target).includes(hiddenJia)) sections.遁甲.push(`时旬首${chart.xunShou}遁于${hiddenJia}，本宫地盘见${hiddenJia}`);

  const palaceParty: Party = { short: '宫', label: `${target.palaceName}宫`, element: target.element };
  const heaven: Party = { short: '天盘干', label: `天盘${target.heavenStem}`, element: GAN_WUXING[target.heavenStem] ?? '' };
  const earth: Party = { short: '地盘干', label: `地盘${target.earthStem}`, element: GAN_WUXING[target.earthStem] ?? '' };
  const add = (type: string, part: QimenBoardPart, found: ReturnType<typeof relation>) => {
    if (found) sections.生克.push({ 类型: type, 位置: [{ 宫位序号: index, 部位: part }], 结果: found.result, 说明: found.text });
  };
  if (!centerOnTurningBoard) {
    add('门宫', '八门', relation({ short: '门', label: target.gate, element: target.gateElement }, palaceParty));
    add('星宫', '九星', relation({ short: '星', label: target.star, element: target.starElement }, palaceParty));
    if (target.heavenStem) add('天盘干与宫', '天盘天干', relation(heaven, palaceParty));
  }
  if (target.earthStem) add('地盘干与宫', '地盘天干', relation(earth, palaceParty));
  if (target.heavenStem && target.earthStem) add('天地盘干', '天盘天干', relation(heaven, earth));

  return {
    sections,
    calculationOptions: { ...(chart.inputSnapshot ?? {}), ruleVersion: QIMEN_PALACE_RULE_VERSION },
  };
}
