import { withRulesJSON } from '../../shared/calculation-rules.js';
import { drilldownText } from '../shared/drilldown-render.js';
import { ganzhiRelationLine, ganzhiRelationRow, type GanzhiRelationRowJSON } from './relations-render.js';
import type { BaziHepanOutput, BaziHepanPerson } from './hepan.js';

export interface BaziHepanPersonJSON {
  称呼: string;
  性别: string;
  四柱: Array<{ 柱: string; 干支: string; 纳音: string; }>;
  日主: string;
  月令: string;
  /** 日主在月令中的旺相休囚死 */
  月令旺衰: string;
  生肖: string;
  缺失五行: string[];
}

export interface BaziHepanCanonicalJSON {
  双方: BaziHepanPersonJSON[];
  日主互见: { 说明: string[]; 五行生克: string; };
  年命纳音: { 说明: string; 五行生克: string; };
  日柱之间: GanzhiRelationRowJSON[];
  年柱之间: GanzhiRelationRowJSON[];
  其余关系: GanzhiRelationRowJSON[];
  五行互补: string[];
  口径: string[];
}

const HEPAN_NOTES = [
  '只列两盘之间的事实，不打分、不判吉凶与是否相配；各自盘内的干支关系见各自的八字命盘',
  '干支关系只列同时涉及双方柱位的天干五合、天干相冲与地支六合、三合、半合、三会、六冲、相刑、相害、相破；合局与三刑按两盘八柱全体出现判断，可由双方的字共同组成，列出参与的全部柱位',
  '日柱之间：同时涉及双方日柱的关系（日干为日主，日支为夫妻宫）；年柱之间：同时涉及双方年柱、不涉及双方日柱的关系；其余关系另列',
  '不计拱合、暗合、半会；半合在第三支出现于两盘任一柱时不报（已成三合）',
  '日主互见：对方日干相对己方日主的十神；五行生克取两日干的五行',
  '生肖取年柱地支（以立春换年）；年命纳音取年柱纳音，生克取纳音五行',
  '缺失五行：天干、地支本气与藏干都没有出现的五行，只记有无，不计权重',
];

const GENDER = { male: '男', female: '女' } as const;

function personJSON(person: BaziHepanPerson): BaziHepanPersonJSON {
  return {
    称呼: person.name,
    性别: GENDER[person.gender],
    四柱: person.pillars.map((pillar) => ({ 柱: pillar.label, 干支: `${pillar.stem}${pillar.branch}`, 纳音: pillar.naYin })),
    日主: `${person.dayMaster.stem}${person.dayMaster.element}`,
    月令: person.monthCommand.branch,
    月令旺衰: person.monthCommand.dayMasterState,
    生肖: person.zodiac,
    缺失五行: [...person.missingElements],
  };
}

function seesLines(result: BaziHepanOutput): string[] {
  const [a, b] = result.people;
  return [
    `${b.name}日主${b.dayMaster.stem}${b.dayMaster.element}是${a.name}的${result.dayMasters.aSeesB}`,
    `${a.name}日主${a.dayMaster.stem}${a.dayMaster.element}是${b.name}的${result.dayMasters.bSeesA}`,
  ];
}

function complementLines(result: BaziHepanOutput): string[] {
  if (result.complements.length) return result.complements.map((item) => `${item.missingIn}缺${item.element}，${item.presentIn}原局有${item.element}`);
  return [result.people.every((person) => !person.missingElements.length) ? '双方原局五行俱全' : '一方所缺的五行，另一方原局也没有'];
}

function renderBaziHepanJSONBase(result: BaziHepanOutput): BaziHepanCanonicalJSON {
  const [a, b] = result.people;
  return {
    双方: result.people.map(personJSON),
    日主互见: { 说明: seesLines(result), 五行生克: result.dayMasters.relation },
    年命纳音: { 说明: `${a.name}${result.naYin.a}，${b.name}${result.naYin.b}`, 五行生克: result.naYin.relation },
    日柱之间: result.dayRelations.map(ganzhiRelationRow),
    年柱之间: result.yearRelations.map(ganzhiRelationRow),
    其余关系: result.otherRelations.map(ganzhiRelationRow),
    五行互补: complementLines(result),
    口径: HEPAN_NOTES,
  };
}

function personLine(person: BaziHepanPerson, full: boolean): string {
  const pillars = person.pillars.map((pillar) => `${pillar.stem}${pillar.branch}`).join(' ');
  const naYin = full ? `；四柱纳音 ${person.pillars.map((pillar) => pillar.naYin || '-').join(' ')}` : '';
  const missing = person.missingElements.length ? person.missingElements.join('、') : '无';
  return `- ${person.name}（${GENDER[person.gender]}）：${pillars}；日主${person.dayMaster.stem}${person.dayMaster.element}，生于${person.monthCommand.branch}月（${person.monthCommand.dayMasterState}）；属${person.zodiac}；缺失五行：${missing}${naYin}`;
}

/** 两盘各自的盘面与盘内关系在各自命盘里；这里只写双方四柱的要点和两盘之间的事实。 */
function renderBaziHepanTextBase(result: BaziHepanOutput, full: boolean): string {
  const [a, b] = result.people;
  const relations = (facts: BaziHepanOutput['dayRelations']) => (facts.length ? facts.map(ganzhiRelationLine) : ['- 无']);
  return [
    '# 八字合盘', '',
    '## 双方', '', ...result.people.map((person) => personLine(person, full)), '',
    '## 日主互见', '', ...seesLines(result).map((line) => `- ${line}`), `- ${result.dayMasters.relation}`, '',
    '## 日柱之间（日主与夫妻宫）', '', ...relations(result.dayRelations), '',
    '## 年柱之间（生肖与年命）', '',
    `- ${a.name}属${a.zodiac}，${b.name}属${b.zodiac}；年命纳音 ${a.name}${result.naYin.a}、${b.name}${result.naYin.b}：${result.naYin.relation}`,
    ...(result.yearRelations.length ? result.yearRelations.map(ganzhiRelationLine) : []), '',
    '## 其余干支关系', '', ...relations(result.otherRelations), '',
    '## 五行互补', '', ...complementLines(result).map((line) => `- ${line}`),
  ].join('\n');
}

export const toBaziHepanJson = withRulesJSON(renderBaziHepanJSONBase);
export const toBaziHepanText = drilldownText(HEPAN_NOTES, renderBaziHepanTextBase);
