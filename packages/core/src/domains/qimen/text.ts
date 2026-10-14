import { withRulesText } from '../../shared/calculation-rules.js';
import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  QimenOutput
} from './types.js';
import { GAN_WUXING } from '../../shared/utils.js';
import { formatQimenRuMuStatus } from './json.js';
import type {
  QimenCanonicalTextOptions
} from '../shared/text-options.js';

function formatQimenPalaceStateText(palace: QimenOutput['palaces'][number], dayKongPalaces: Set<number>, hourKongPalaces: Set<number>, panType: QimenOutput['panType']): string {
  if (palace.palaceIndex === 5 && panType !== 'fei' && panType !== '飞盘') return '(寄宫参看对应宫位)';
  const states = [
    dayKongPalaces.has(palace.palaceIndex) ? '日空' : null,
    hourKongPalaces.has(palace.palaceIndex) ? '时空' : null,
    palace.isYiMa ? '驿马' : null,
    palace.isRuMu ? formatQimenRuMuStatus(palace) : null,
    palace.isMenPo ? '门迫' : null,
    palace.isJiXing ? '六仪击刑' : null,
  ].filter(Boolean).join('、');
  return states || '-';
}

function formatQimenMonthPhaseLine(monthPhase: Record<string, string>): string | null {
  const phaseGroups = new Map<string, string[]>();
  for (const [stem, phase] of Object.entries(monthPhase)) {
    if (!phase) continue;
    phaseGroups.set(phase, [...(phaseGroups.get(phase) || []), stem]);
  }
  if (phaseGroups.size === 0) return null;

  const parts: string[] = [];
  for (const [phase, stems] of phaseGroups.entries()) {
    const stemsWithElement = stems.map((stem) => `${stem}${GAN_WUXING[stem] || ''}`).join('');
    parts.push(`${phase}：${stemsWithElement}`);
  }
  return parts.join('、');
}

function formatQimenPalaceName(palace: QimenOutput['palaces'][number]): string {
  return `${palace.palaceName}${palace.palaceIndex}(${palace.element || '-'})`;
}

export const renderQimenCanonicalText = withRulesText(renderQimenCanonicalTextBase);

function renderQimenCanonicalTextBase(result: QimenOutput, options: QimenCanonicalTextOptions = {}): string {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const dunText = result.dunType === 'yang' ? '阳遁' : '阴遁';
  const juLabel = `${dunText}${result.juNumber}局`;
  const dayKongPalaces = new Set(result.kongWang.dayKong.palaces);
  const hourKongPalaces = new Set(result.kongWang.hourKong.palaces);
  const lines: string[] = [
    '# 奇门遁甲排盘',
    '',
    '## 基本信息',
    ...(result.question ? [`- 占问: ${result.question}`] : []),
    `- 四柱: ${result.siZhu.year} ${result.siZhu.month} ${result.siZhu.day} ${result.siZhu.hour}`,
    `- 节气: ${result.dateInfo.solarTerm} (${juLabel} · ${result.yuan})`,
    `- 旬首: ${result.xunShou}`,
    `- 值符 (大局趋势): ${result.zhiFu.star}`,
    `- 值使 (执行枢纽): ${result.zhiShi.gate}`,
  ];
  if (detailLevel === 'full') {
    lines.push(`- 公历: ${result.dateInfo.solarDate}`);
    lines.push(`- 农历: ${result.dateInfo.lunarDate}`);
    if (result.dateInfo.solarTermRange) lines.push(`- 节气范围: ${result.dateInfo.solarTermRange}`);
    lines.push(`- 盘式: ${result.panType}`);
    lines.push(`- 定局法: ${result.juMethod}`);
  }
  lines.push('');
  lines.push('## 九宫盘');
  lines.push('');
  if (detailLevel === 'full') {
    lines.push('| 宫位(五行) | 八神 | 九星(五行) | 八门(五行) | 天盘天干 | 地盘天干 | 宫位状态 | 方位 | 格局 |');
    lines.push('|------------|------|------------|------------|----------|----------|----------|------|------|');
  } else {
    lines.push('| 宫位(五行) | 八神 | 九星(五行) | 八门(五行) | 天盘天干 | 地盘天干 | 宫位状态 |');
    lines.push('|------------|------|------------|------------|----------|----------|----------|');
  }

  for (const palace of result.palaces) {
    const starLabel = [palace.star ? `${palace.star}(${palace.starElement || ''})` : '-', ...(palace.hostedStars ?? []).map(star => `${star}(寄)`)].join('、');
    const gateLabel = palace.gate ? `${palace.gate}(${palace.gateElement || ''})` : '-';
    const row = [
      formatQimenPalaceName(palace),
      palace.deity || '-',
      starLabel,
      gateLabel,
      [palace.heavenStem || '-', ...(palace.hostedHeavenStems ?? []).map(stem => `${stem}(寄)`)].join('、'),
      [palace.earthStem || '-', ...(palace.hostedEarthStems ?? []).map(stem => `${stem}(寄)`)].join('、'),
      formatQimenPalaceStateText(palace, dayKongPalaces, hourKongPalaces, result.panType),
    ];
    if (detailLevel === 'full') {
      row.push(palace.direction || '-');
      row.push(palace.formations.length > 0 ? palace.formations.join('、') : '-');
    }
    lines.push(`| ${row.join(' | ')} |`);
  }

  if (detailLevel === 'full') {
    lines.push('');
    lines.push('## 补充信息');
    lines.push('');
    lines.push(`- 日空: ${result.kongWang.dayKong.branches.join('、') || '-'} (${result.kongWang.dayKong.palaces.map((index) => `${result.palaces[index - 1]?.palaceName || ''}${index}`).join('、') || '-'})`);
    lines.push(`- 时空: ${result.kongWang.hourKong.branches.join('、') || '-'} (${result.kongWang.hourKong.palaces.map((index) => `${result.palaces[index - 1]?.palaceName || ''}${index}`).join('、') || '-'})`);
    lines.push(`- 驿马: ${result.yiMa.branch || '-'}${result.yiMa.palace ? ` (${result.palaces[result.yiMa.palace - 1]?.palaceName || ''}${result.yiMa.palace})` : ''}`);

    const monthPhaseLine = result.monthPhase ? formatQimenMonthPhaseLine(result.monthPhase) : null;
    if (monthPhaseLine) {
      lines.push('');
      lines.push('## 月令旺衰');
      lines.push('');
      lines.push(monthPhaseLine);
    }

  }

  // 格局是断盘主要依据，默认档也输出；全盘格局只列一次，不在九宫里逐宫重复
  if (result.globalFormations.length > 0) {
    lines.push('');
    lines.push('## 全局格局');
    lines.push('');
    for (const formation of result.globalFormations) {
      lines.push(`- ${formation}`);
    }
  }

  return lines.join('\n');
}
