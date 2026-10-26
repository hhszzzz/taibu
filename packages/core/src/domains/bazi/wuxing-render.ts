import { withRulesJSON } from '../../shared/calculation-rules.js';
import { drilldownText } from '../shared/drilldown-render.js';
import type { GanzhiRelationRowJSON } from './relations-render.js';
import type { BaziWuxingOutput, BaziWuxingSection, StemRoots, WuxingFact, WuxingRootFact } from './wuxing.js';

/** 通根行：位置为 [天干, 地支]，藏干是地支里与该天干同五行的那个字，结果为本气、中气或余气 */
export interface BaziWuxingRootJSON extends GanzhiRelationRowJSON {
  藏干: string;
  结果: string;
}

/** 日主、月令与缺失五行总在；其余事实组只在被选取（或未给 sections）时出现 */
export interface BaziWuxingCanonicalJSON {
  日主: { 天干: string; 五行: string; };
  月令: {
    月支: string; 月令五行: string; 旺: string; 相: string; 休: string; 囚: string; 死: string; 日主状态: string;
    /** 月令各藏干透出到哪些天干（年干、月干、时干）；空数组为不透 */
    藏干: Array<{ 天干: string; 气性: string; 透出: string[]; }>;
  };
  缺失五行: string[];
  /** 只在出生时辰未知时出现：事实只取年、月、日三柱 */
  出生时辰?: string;
  筛选?: { 事实组: BaziWuxingSection[]; };
  /** 日主在前，其后年干、月干、时干的根 */
  通根?: BaziWuxingRootJSON[];
  /** 没有同五行藏干的天干，如「年干丙火」 */
  无根?: string[];
  干支自坐?: GanzhiRelationRowJSON[];
  相邻天干?: GanzhiRelationRowJSON[];
  口径: string[];
}

const WUXING_NOTES = [
  '只列旺衰与生克的事实，不判断身强身弱、格局或喜用神；旺衰不是五行字数相加，不设权重、不做合计',
  '月令旺衰：同月令五行者旺，月令所生者相，生月令者休，克月令者囚，月令所克者死；辰戌丑未月以土论',
  '月令藏干逐个列出透出与否；透出只看年、月、时干，日主本身不算透',
  '通根取四支藏干中与该天干同五行者，注明本气、中气或余气；没有同五行藏干的天干记为无根',
  '缺失五行：天干、地支本气、藏干都没有出现的五行',
  '给出 sections 时只列所选事实组；日主、月令与缺失五行总在',
];

/** 时辰未知时缺失五行只就三柱而言 */
const UNKNOWN_TIME_NOTE = '未知（只看年、月、日三柱；缺失的五行可能由时柱补上）';

function row(fact: WuxingFact): GanzhiRelationRowJSON {
  return {
    类型: fact.type,
    位置: fact.cells.map((cell) => ({ 柱: cell.pillar, 部位: cell.part, 字: cell.char })),
    ...(fact.result ? { 结果: fact.result } : {}),
    说明: fact.description,
  };
}

const rootRow = (fact: WuxingRootFact): BaziWuxingRootJSON => ({ ...row(fact), 藏干: fact.hidden, 结果: fact.result });

function renderBaziWuxingJSONBase(result: BaziWuxingOutput): BaziWuxingCanonicalJSON {
  const month = result.monthCommand;
  return {
    日主: { 天干: result.dayMaster.stem, 五行: result.dayMaster.element },
    月令: {
      月支: month.branch, 月令五行: month.element, ...month.states, 日主状态: month.dayMasterState,
      藏干: month.hiddenStems.map((hidden) => ({ 天干: hidden.stem, 气性: hidden.qiType, 透出: [...hidden.revealedIn] })),
    },
    缺失五行: [...result.missingElements],
    ...(result.birthTimeUnknown ? { 出生时辰: UNKNOWN_TIME_NOTE } : {}),
    ...(result.sections ? { 筛选: { 事实组: [...result.sections] } } : {}),
    ...(result.stemRoots ? {
      通根: result.stemRoots.flatMap((item) => item.roots.map(rootRow)),
      无根: result.stemRoots.filter((item) => !item.roots.length).map(stemName),
    } : {}),
    ...(result.pillarSelf ? { 干支自坐: result.pillarSelf.map(row) } : {}),
    ...(result.adjacentStems ? { 相邻天干: result.adjacentStems.map(row) } : {}),
    口径: WUXING_NOTES,
  };
}

const stemName = (item: StemRoots) => `${item.label}${item.stem}${item.element}`;
const BRANCH_LABELS: Record<string, string> = { 年柱: '年支', 月柱: '月支', 日柱: '日支', 时柱: '时支' };

/** 「日主戊土：月支丑（藏己·本气）、时支未（藏己·本气）」；无根的天干也列出 */
const rootLine = (item: StemRoots) => `- ${stemName(item)}：${item.roots.length
  ? item.roots.map((fact) => `${BRANCH_LABELS[fact.cells[1].pillar]}${fact.cells[1].char}（藏${fact.hidden}·${fact.result}）`).join('、')
  : '无根'}`;

function renderBaziWuxingTextBase(result: BaziWuxingOutput): string {
  const month = result.monthCommand;
  const hidden = month.hiddenStems.map((item) => `${item.stem}（${item.qiType}）${item.revealedIn.length ? `透${item.revealedIn.join('、')}` : '不透'}`);
  const facts = (title: string, items: WuxingFact[] | undefined) => items
    ? ['', `## ${title}`, '', ...(items.length ? items.map((fact) => `- ${fact.description}${fact.result && !fact.description.includes(fact.result) ? `（${fact.result}）` : ''}`) : ['- 无'])]
    : [];
  const lines = [
    '# 八字五行旺衰详查',
    ...(result.sections ? ['', '## 查询', '', `- 只取：${result.sections.join('、')}（去掉 sections 可看全部事实组）`] : []),
    '', '## 月令', '',
    `- 月支${month.branch}（${month.element}）：${(['旺', '相', '休', '囚', '死'] as const).map((state) => `${month.states[state]}${state}`).join('、')}；日主${result.dayMaster.stem}${result.dayMaster.element}${month.dayMasterState}`,
    `- 藏干：${hidden.join('；')}`,
    ...(result.stemRoots ? ['', '## 通根', '', ...result.stemRoots.map(rootLine)] : []),
    ...facts('干支自坐', result.pillarSelf),
    ...facts('相邻天干', result.adjacentStems),
    '', '## 缺失五行', '', `- ${result.missingElements.join('、') || '无'}`,
    ...(result.birthTimeUnknown ? [`- 出生时辰${UNKNOWN_TIME_NOTE}`] : []),
  ];
  return lines.join('\n');
}

export const toBaziWuxingJson = withRulesJSON(renderBaziWuxingJSONBase);
export const toBaziWuxingText = drilldownText(WUXING_NOTES, renderBaziWuxingTextBase);
