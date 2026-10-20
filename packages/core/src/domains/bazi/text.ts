import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  BaziOutput
} from './types.js';
import { GAN_WUXING } from '../../shared/utils.js';
import { baziBranchRelationText } from './json.js';
import type {
  BaziCanonicalTextOptions
} from '../shared/text-options.js';

function formatTrueSolarBlock(info: { clockTime: string; trueSolarTime: string; longitude: number; correctionMinutes: number; trueTimeIndex: number; dayOffset: number; }): string[] {
  const dayOffsetLabel = info.dayOffset > 0
    ? `后${info.dayOffset}日`
    : info.dayOffset < 0
      ? `前${Math.abs(info.dayOffset)}日`
      : '当日';

  return [
    `- 钟表时间: ${info.clockTime}`,
    `- 真太阳时: ${info.trueSolarTime}（经度 ${info.longitude}°，校正 ${info.correctionMinutes > 0 ? '+' : ''}${info.correctionMinutes} 分钟）`,
    `- 真太阳时索引: ${info.trueTimeIndex}`,
    `- 跨日偏移: ${dayOffsetLabel}`,
  ];
}

function buildBaziCanonicalStemRelations(result: Pick<BaziOutput, 'tianGanChongKe' | 'tianGanWuHe'>): string[] {
  const relationParts: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    relationParts.push(value);
  };

  for (const item of result.tianGanWuHe) {
    pushUnique(`${item.stemA}${item.stemB}合${item.resultElement}`);
  }
  for (const item of result.tianGanChongKe) {
    pushUnique(`${item.stemA}${item.stemB}冲克`);
  }

  return relationParts;
}

function buildBaziCanonicalBranchRelations(result: Pick<BaziOutput, 'fourPillars' | 'relations' | 'diZhiBanHe' | 'diZhiSanHui'>): string[] {
  const relationParts: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    relationParts.push(value);
  };

  for (const relation of result.relations) pushUnique(baziBranchRelationText(result, relation));
  for (const item of result.diZhiBanHe) {
    pushUnique(`${item.branches.join('')}半合${item.resultElement}`);
  }
  for (const item of result.diZhiSanHui) {
    pushUnique(`${item.branches.join('')}三会${item.resultElement}`);
  }

  return relationParts;
}

export function renderBaziCanonicalText(chart: BaziOutput, options: BaziCanonicalTextOptions = {}): string {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  if (detailLevel === 'full') {
    return renderBaziCanonicalFullText(chart, options);
  }

  return renderBaziCanonicalDefaultText(chart, options);
}

function renderBaziCanonicalDefaultText(chart: BaziOutput, options: BaziCanonicalTextOptions = {}): string {
  const { dayun } = options;
  const lines: string[] = ['# 八字命盘', '', '## 命局全盘'];
  if (options.name) lines.push(`- 姓名: ${options.name}`);
  lines.push(`- 性别: ${chart.gender === 'male' ? '男' : '女'}`);
  lines.push(`- 日主: ${chart.dayMaster}`);
  if (chart.birthPlace) lines.push(`- 出生地: ${chart.birthPlace}`);
  if (chart.trueSolarTimeInfo) {
    lines.push(...formatTrueSolarBlock(chart.trueSolarTimeInfo));
  }
  lines.push('');
  lines.push('| 柱 | 干支 | 天干(十神) | 地支藏干(十神) | 地势 | 空亡 |');
  lines.push('|---|------|------------|----------------|------|------|');
  for (const [label, pillar] of [
    ['年柱', chart.fourPillars.year],
    ['月柱', chart.fourPillars.month],
    ['日柱', chart.fourPillars.day],
    ['时柱', chart.fourPillars.hour],
  ] as const) {
    const hiddenStemsText = pillar.hiddenStems.length > 0
      ? pillar.hiddenStems.map((item) => `${item.stem}(${item.tenGod || '-'})`).join(' ')
      : '-';
    const stemText = label === '日柱'
      ? `${pillar.stem}(日主)`
      : `${pillar.stem}(${pillar.tenGod || '-'})`;
    lines.push(`| ${label} | ${pillar.stem}${pillar.branch} | ${stemText} | ${hiddenStemsText} | ${pillar.diShi || '-'} | ${pillar.kongWang?.isKong ? '空' : '-'} |`);
  }
  lines.push('');

  const stemRelationParts = buildBaziCanonicalStemRelations(chart);
  const branchRelationParts = buildBaziCanonicalBranchRelations(chart);
  if (stemRelationParts.length > 0 || branchRelationParts.length > 0) {
    lines.push('## 干支关系');
    if (stemRelationParts.length > 0) lines.push(`- 天干: ${stemRelationParts.join('；')}`);
    if (branchRelationParts.length > 0) lines.push(`- 地支: ${branchRelationParts.join('；')}`);
  }

  if (dayun) {
    lines.push('');
    lines.push('## 大运轨迹');
    lines.push(`- 起运: ${dayun.startAge}岁（${dayun.startAgeDetail}）`);
    lines.push('');
    lines.push('| 起运年份 | 年龄 | 大运干支 | 天干(十神) | 地支藏干(十神) |');
    lines.push('|----------|------|----------|------------|----------------|');
    for (const item of dayun.list) {
      const hiddenStemsText = item.hiddenStems?.length
        ? item.hiddenStems.map((hs) => `${hs.stem}(${hs.tenGod})`).join(' ')
        : '-';
      lines.push(`| ${item.startYear} | ${item.startAge}岁 | ${item.ganZhi} | ${item.stem}(${item.tenGod || '-'}) | ${hiddenStemsText} |`);
    }
  }

  return lines.join('\n');
}

function renderBaziCanonicalFullText(chart: BaziOutput, options: BaziCanonicalTextOptions = {}): string {
  const { dayun } = options;
  const lines: string[] = ['# 八字命盘', '', '## 基本信息'];
  if (options.name) lines.push(`- 姓名: ${options.name}`);
  lines.push(`- 性别: ${chart.gender === 'male' ? '男' : '女'}`);
  lines.push(`- 日主: ${chart.dayMaster}`);
  lines.push(`- 命主五行: ${chart.dayMaster}${GAN_WUXING[chart.dayMaster.charAt(0)] || ''}`);
  if (chart.birthPlace) lines.push(`- 出生地: ${chart.birthPlace}`);
  if (chart.trueSolarTimeInfo) {
    lines.push(...formatTrueSolarBlock(chart.trueSolarTimeInfo));
  }
  if (chart.kongWang?.kongZhi?.length) lines.push(`- 空亡: ${chart.kongWang.kongZhi.join('')}`);
  if (chart.taiYuan) lines.push(`- 胎元: ${chart.taiYuan}`);
  if (chart.mingGong) lines.push(`- 命宫: ${chart.mingGong}`);
  lines.push('');
  lines.push('## 四柱');
  lines.push('| 柱 | 干支 | 天干(十神) | 地支藏干(十神) | 地势 | 纳音 | 神煞 |');
  lines.push('|---|------|------------|----------------|------|------|------|');
  for (const [label, pillar] of [
    ['年柱', chart.fourPillars.year],
    ['月柱', chart.fourPillars.month],
    ['日柱', chart.fourPillars.day],
    ['时柱', chart.fourPillars.hour],
  ] as const) {
    const hiddenStemsText = pillar.hiddenStems.length > 0
      ? pillar.hiddenStems.map((item) => `${item.stem}(${item.tenGod || '-'})`).join(' ')
      : '-';
    const stemText = label === '日柱'
      ? `${pillar.stem}(日主)`
      : `${pillar.stem}(${pillar.tenGod || '-'})`;
    const shenShaText = pillar.shenSha?.length ? pillar.shenSha.join('、') : '-';
    lines.push(`| ${label} | ${pillar.stem}${pillar.branch} | ${stemText} | ${hiddenStemsText} | ${pillar.diShi || '-'} | ${pillar.naYin || '-'} | ${shenShaText} |`);
  }
  lines.push('');

  const stemRelationParts = buildBaziCanonicalStemRelations(chart);
  const branchRelationParts = buildBaziCanonicalBranchRelations(chart);
  if (stemRelationParts.length > 0 || branchRelationParts.length > 0) {
    lines.push('## 干支关系');
    if (stemRelationParts.length > 0) lines.push(`- 天干: ${stemRelationParts.join('；')}`);
    if (branchRelationParts.length > 0) lines.push(`- 地支: ${branchRelationParts.join('；')}`);
  }

  if (dayun) {
    lines.push('');
    lines.push('## 大运轨迹');
    lines.push(`- 起运: ${dayun.startAge}岁（${dayun.startAgeDetail}）`);
    lines.push('');
    lines.push('| 起运年份 | 年龄 | 大运干支 | 天干(十神) | 地支藏干(十神) | 地势 | 纳音 | 神煞 |');
    lines.push('|----------|------|----------|------------|----------------|------|------|------|');
    for (const item of dayun.list) {
      const hiddenStemsText = item.hiddenStems?.length
        ? item.hiddenStems.map((hs) => `${hs.stem}(${hs.tenGod})`).join('、')
        : '-';
      const shenShaText = item.shenSha?.length ? item.shenSha.join('、') : '-';
      lines.push(`| ${item.startYear} | ${item.startAge}岁 | ${item.ganZhi} | ${item.stem}(${item.tenGod || '-'}) | ${hiddenStemsText} | ${item.diShi || '-'} | ${item.naYin || '-'} | ${shenShaText} |`);
    }
  }

  return lines.join('\n');
}
