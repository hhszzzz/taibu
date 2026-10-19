import { withRulesJSON, withRulesText } from '../../shared/calculation-rules.js';
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

function renderQimenPalaceTextBase(result: QimenPalaceOutput): string {
  return renderFactSections('奇门宫位详查', { ...result.sections, 口径: QIMEN_PALACE_NOTES });
}

export const toQimenPalaceJson = withRulesJSON(renderQimenPalaceJSONBase);
export const toQimenPalaceText = withRulesText(renderQimenPalaceTextBase);
