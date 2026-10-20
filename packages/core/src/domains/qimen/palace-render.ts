import { withRulesJSON } from '../../shared/calculation-rules.js';
import { drilldownText } from '../shared/drilldown-render.js';
import { renderFactSections } from '../shared/fact-sections-text.js';
import type { QimenPalaceOutput, QimenPalaceSections } from './palace.js';

export type QimenPalaceCanonicalJSON = QimenPalaceSections & { 口径: string[] };

const QIMEN_PALACE_NOTES = [
  '只列盘面事实与五行生克，不判断吉凶与用神',
  '柱干定位取天盘（含寄干）；甲不上盘，取本柱所遁六仪；天盘不见时取地盘；多宫同见时取宫位序号最小者，其余列入「同见宫位」',
  '状态、旺衰与格局沿用排盘结果：旺衰以月支季节定，空亡分日空、时空，马星取时支驿马',
  '生克用 a生b / a克b / 比和 表示五行方向；门克宫即门迫',
  '转盘中五不布星门神，只列地盘干与寄宫去向；不计暗干',
];

function renderQimenPalaceJSONBase(result: QimenPalaceOutput): QimenPalaceCanonicalJSON {
  return { ...structuredClone(result.sections), 口径: [...QIMEN_PALACE_NOTES] };
}

/**
 * 「宫位：坎1」已含宫名与序号，默认文本不再分写宫名、宫位序号；查询段不重复宫位，
 * 直接指定宫位时查询段没有别的内容，整段不写，按柱干等定位时才写出定位依据。
 */
function renderQimenPalaceTextBase(result: QimenPalaceOutput, full: boolean): string {
  if (full) return renderFactSections('奇门宫位详查', { ...result.sections });
  const { 查询: query, 宫位: palace } = result.sections;
  const located = query.方式 !== '指定宫位' || query.定位 !== undefined || query.同见宫位 !== undefined;
  return renderFactSections('奇门宫位详查', {
    ...result.sections,
    查询: located ? { 方式: query.方式, 定位: query.定位, 同见宫位: query.同见宫位 } : undefined,
    宫位: { 宫位: palace.宫位, 方位: palace.方位, 宫位五行: palace.宫位五行, 宫旺衰: palace.宫旺衰 },
  });
}

export const toQimenPalaceJson = withRulesJSON(renderQimenPalaceJSONBase);
export const toQimenPalaceText = drilldownText(QIMEN_PALACE_NOTES, renderQimenPalaceTextBase);
