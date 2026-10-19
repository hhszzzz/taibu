import { withRulesJSON, withRulesText } from '../../shared/calculation-rules.js';
import { ganzhiRelationLine, ganzhiRelationRow, type GanzhiRelationRowJSON } from './relations-render.js';
import type { BaziLiunianScanOutput, BaziLiunianYear } from './liunian-scan.js';

export interface BaziLiunianYearJSON {
  流年: number;
  干支: string;
  天干十神: string;
  地支主气十神: string;
  纳音: string;
  大运?: string;
  小运?: string;
  原局关系: GanzhiRelationRowJSON[];
  大运关系: GanzhiRelationRowJSON[];
  太岁关系?: string[];
  岁运提示?: string[];
}

export interface BaziLiunianScanCanonicalJSON {
  扫描范围: { 起始年: number; 结束年: number; 筛选?: string; 列出年数: number; };
  原局四柱: Array<{ 柱: string; 干支: string; }>;
  逐年: BaziLiunianYearJSON[];
  口径: string[];
}

const SCAN_NOTES = [
  '只列流年与原局、与大运（起运前为小运）的干支关系事实，不判断吉凶',
  '流年按公历年份取干支，所在大运按起运年份划分，与 bazi_dayun 同口径',
  '大运与原局之间的关系每年相同，逐年不重复列出；需要时用 bazi_relations 查询',
  '给出 focus 时只列涉及该柱位或该关系类型的年份与关系；太岁关系照常列出',
  '关系判定口径同 bazi_relations：不计拱合、暗合、半会，天克地冲取天干相冲且地支六冲',
];

function yearJSON(item: BaziLiunianYear): BaziLiunianYearJSON {
  return {
    流年: item.year,
    干支: `${item.pillar.stem}${item.pillar.branch}`,
    天干十神: item.pillar.stemTenGod,
    地支主气十神: item.pillar.branchTenGod,
    纳音: item.pillar.naYin,
    ...(item.fortune ? { [item.fortune.layer]: `${item.fortune.ganZhi}（${item.fortune.label}）` } : {}),
    原局关系: item.natalRelations.map(ganzhiRelationRow),
    大运关系: item.fortuneRelations.map(ganzhiRelationRow),
    ...(item.taiSui.length ? { 太岁关系: [...item.taiSui] } : {}),
    ...(item.fortuneHints.length ? { 岁运提示: [...item.fortuneHints] } : {}),
  };
}

function renderScanJSONBase(result: BaziLiunianScanOutput): BaziLiunianScanCanonicalJSON {
  return {
    扫描范围: {
      起始年: result.range.fromYear,
      结束年: result.range.toYear,
      ...(result.range.focus ? { 筛选: result.range.focus } : {}),
      列出年数: result.range.matchedYears,
    },
    原局四柱: result.natal.map((p) => ({ 柱: p.label, 干支: p.ganZhi })),
    逐年: result.years.map(yearJSON),
    口径: SCAN_NOTES,
  };
}

function renderScanTextBase(result: BaziLiunianScanOutput): string {
  const range = result.range;
  const lines = [
    '# 八字流年扫描', '',
    '## 扫描范围', '',
    `- ${range.fromYear}–${range.toYear} 年${range.focus ? `，筛选：${range.focus}` : ''}，列出 ${range.matchedYears} 年`,
    `- 原局：${result.natal.map((p) => `${p.label}${p.ganZhi}`).join(' ')}`,
  ];
  for (const item of result.years) {
    lines.push('', `## ${item.year} ${item.pillar.stem}${item.pillar.branch}`, '');
    lines.push(`- 十神：天干${item.pillar.stemTenGod || '-'}，地支主气${item.pillar.branchTenGod || '-'}；纳音${item.pillar.naYin || '-'}`);
    if (item.fortune) lines.push(`- ${item.fortune.layer}：${item.fortune.ganZhi}（${item.fortune.label}）`);
    lines.push(...item.natalRelations.map(ganzhiRelationLine), ...item.fortuneRelations.map(ganzhiRelationLine));
    if (!item.natalRelations.length && !item.fortuneRelations.length) lines.push('- 关系：无');
    if (item.taiSui.length) lines.push(`- 太岁：${item.taiSui.join('、')}`);
    if (item.fortuneHints.length) lines.push(...item.fortuneHints.map((hint) => `- 岁运：${hint}`));
  }
  if (!result.years.length) lines.push('', '## 逐年', '', '- 范围内没有符合筛选的年份');
  lines.push('', '## 口径', '', ...SCAN_NOTES.map((note) => `- ${note}`));
  return lines.join('\n');
}

export const toBaziLiunianScanJson = withRulesJSON(renderScanJSONBase);
export const toBaziLiunianScanText = withRulesText(renderScanTextBase);
