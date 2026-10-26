/**
 * 八字合盘：两人各排四柱，列出两盘之间的干支关系（天干五合/相冲与地支六合、三合、半合、三会、六冲、刑、害、破），
 * 日主互见的十神与五行生克，日柱（日主与夫妻宫）、年柱（生肖与年命纳音）之间的关系，以及一方所缺、另一方所有的五行。
 * 只陈述事实，不打分、不判吉凶与是否相配；各自盘内的关系见各自命盘。
 */

import { calculateTenGod, getElementRelation, STEM_ELEMENTS, WU_XING_ORDER } from '../../shared/utils.js';
import { CoreInputError } from '../../shared/validation.js';
import { analyzeGanzhiRelations, type GanzhiPillar, type GanzhiRelationFact } from '../shared/ganzhi-relations.js';
import { baziPillarEntries, calculateBaziData, getNaYin, getNaYinElement } from './calculate.js';
import { deriveBaziWuxing, type WangShuaiState } from './wuxing.js';
import type { BaziInput, BaziOutput } from './types.js';

export const BAZI_HEPAN_RULE_VERSION = 'bazi-hepan-2026.10';
export const BAZI_HEPAN_DEFAULT_NAMES = ['甲方', '乙方'] as const;
const ZODIAC: Readonly<Record<string, string>> = {
  子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇', 午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪',
};
/** 称呼写进柱名（「甲方日柱」），所以不能含空白或关系行的分隔符 */
const NAME_PATTERN = /^[^\s·｜|]{1,12}$/u;

export interface BaziHepanPersonInput extends BaziInput {
  /** 称呼，标在柱名前；省略时为甲方、乙方 */
  name?: string;
}

export interface BaziHepanInput {
  a: BaziHepanPersonInput;
  b: BaziHepanPersonInput;
}

export interface BaziHepanPerson {
  name: string;
  gender: BaziOutput['gender'];
  pillars: Array<{ label: string; stem: string; branch: string; naYin: string; }>;
  dayMaster: { stem: string; element: string; };
  /** 月令与日主在月令中的旺相休囚死 */
  monthCommand: { branch: string; dayMasterState: WangShuaiState; };
  zodiac: string;
  missingElements: string[];
  /** 出生时辰未知：只有年、月、日三柱，缺失五行只就三柱而言 */
  birthTimeUnknown?: true;
}

export interface BaziHepanOutput {
  people: [BaziHepanPerson, BaziHepanPerson];
  /** 对方日干相对己方日主的十神，与两日主的五行生克 */
  dayMasters: { aSeesB: string; bSeesA: string; relation: string; };
  /** 年柱纳音与其五行生克 */
  naYin: { a: string; b: string; relation: string; };
  /** 同时涉及双方日柱的关系 */
  dayRelations: GanzhiRelationFact[];
  /** 同时涉及双方年柱、且不涉及双方日柱的关系 */
  yearRelations: GanzhiRelationFact[];
  /** 其余两盘之间的关系 */
  otherRelations: GanzhiRelationFact[];
  /** 一方缺失、另一方原局有的五行 */
  complements: Array<{ element: string; missingIn: string; presentIn: string; }>;
  calculationOptions: { ruleVersion: string; people: Array<Record<string, unknown>>; };
}

function personName(value: unknown, fallback: string, path: string): string {
  if (value === undefined) return fallback;
  const name = typeof value === 'string' ? value.trim() : '';
  if (!NAME_PATTERN.test(name)) throw new CoreInputError(path, '须为 1–12 个字，不含空白、「·」或「｜」');
  return name;
}

/** 甲方日主甲木生乙方日主丙火 */
function elementSentence(relation: string, left: string, right: string): string {
  switch (relation) {
    case 'same': return `${left}与${right}比和`;
    case 'produce': return `${left}生${right}`;
    case 'produced': return `${right}生${left}`;
    case 'control': return `${left}克${right}`;
    default: return `${right}克${left}`;
  }
}

export function calculateBaziHepan(input: BaziHepanInput): BaziHepanOutput {
  const names = [personName(input.a?.name, BAZI_HEPAN_DEFAULT_NAMES[0], 'a.name'), personName(input.b?.name, BAZI_HEPAN_DEFAULT_NAMES[1], 'b.name')];
  if (names[0] === names[1]) throw new CoreInputError('b.name', '两人的称呼不能相同');
  const charts = (['a', 'b'] as const).map((key) => {
    try {
      // 称呼只标在柱名前，排盘不读它
      return calculateBaziData(input[key]);
    } catch (error) {
      // 指明是哪一方的出生信息有误
      if (error instanceof CoreInputError) throw new CoreInputError(`${key}${error.path ? `.${error.path}` : ''}`, error.message.slice(error.path ? error.path.length + 1 : 0), error.code);
      throw error;
    }
  });

  const people = charts.map((chart, side): BaziHepanPerson => {
    const wuxing = deriveBaziWuxing(chart);
    return {
      name: names[side],
      gender: chart.gender,
      // 时辰未知的一方只有年、月、日三柱，时柱不参与两盘之间的关系
      pillars: baziPillarEntries(chart).map(({ label, pillar }) => ({ label, stem: pillar.stem, branch: pillar.branch, naYin: getNaYin(pillar.stem, pillar.branch) })),
      dayMaster: { stem: chart.dayMaster, element: STEM_ELEMENTS[chart.dayMaster] },
      monthCommand: { branch: chart.fourPillars.month.branch, dayMasterState: wuxing.monthCommand.dayMasterState },
      zodiac: ZODIAC[chart.fourPillars.year.branch],
      missingElements: wuxing.missingElements,
      ...(chart.birthTimeUnknown ? { birthTimeUnknown: true as const } : {}),
    };
  }) as [BaziHepanPerson, BaziHepanPerson];

  // 两盘各柱按同层口径一起枚举（合局与三刑按两盘全体出现判断，交换甲乙结果不变），只留同时涉及双方的关系；
  // 各自盘内的关系见各自命盘。乙方各柱接在甲方之后，甲方时辰未知时只占三位。
  const pillars: GanzhiPillar[] = people.flatMap((person) => person.pillars.map((pillar) => ({
    label: `${person.name}${pillar.label}`, layer: '原局' as const, stem: pillar.stem, branch: pillar.branch,
  })));
  const offset = people[0].pillars.length;
  const sideOf = (index: number) => (index < offset ? 0 : 1);
  const cross = analyzeGanzhiRelations(pillars)
    .filter((fact) => new Set(fact.participants.map((p) => sideOf(p.index))).size === 2);
  const involvesBoth = (fact: GanzhiRelationFact, pillar: number) =>
    fact.participants.some((p) => p.index === pillar) && fact.participants.some((p) => p.index === pillar + offset);
  const dayRelations = cross.filter((fact) => involvesBoth(fact, 2));
  const yearRelations = cross.filter((fact) => !dayRelations.includes(fact) && involvesBoth(fact, 0));
  const otherRelations = cross.filter((fact) => !dayRelations.includes(fact) && !yearRelations.includes(fact));

  const [a, b] = people;
  const dayLabel = (person: BaziHepanPerson) => `${person.name}日主${person.dayMaster.stem}${person.dayMaster.element}`;
  const naYinA = a.pillars[0].naYin, naYinB = b.pillars[0].naYin;
  const naYinRelation = getElementRelation(getNaYinElement(naYinA), getNaYinElement(naYinB));
  const complements = WU_XING_ORDER.flatMap((element) => [[a, b], [b, a]].flatMap(([missing, present]) =>
    missing.missingElements.includes(element) && !present.missingElements.includes(element)
      ? [{ element, missingIn: missing.name, presentIn: present.name }] : []));

  return {
    people,
    dayMasters: {
      aSeesB: calculateTenGod(a.dayMaster.stem, b.dayMaster.stem),
      bSeesA: calculateTenGod(b.dayMaster.stem, a.dayMaster.stem),
      relation: elementSentence(getElementRelation(a.dayMaster.element, b.dayMaster.element), dayLabel(a), dayLabel(b)),
    },
    naYin: {
      a: naYinA,
      b: naYinB,
      relation: elementSentence(naYinRelation, `${a.name}年命${naYinA}`, `${b.name}年命${naYinB}`),
    },
    dayRelations,
    yearRelations,
    otherRelations,
    complements,
    calculationOptions: {
      ruleVersion: BAZI_HEPAN_RULE_VERSION,
      people: charts.map((chart, side) => ({
        name: names[side],
        ...(chart.calculationOptions ?? {}),
        ...(chart.trueSolarTimeInfo ? { trueSolarTime: chart.trueSolarTimeInfo } : {}),
      })),
    },
  };
}
