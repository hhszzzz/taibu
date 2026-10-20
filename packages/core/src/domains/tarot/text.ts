import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  TarotOutput
} from './types.js';
import type {
  TarotCanonicalTextOptions
} from '../shared/text-options.js';

export function renderTarotCanonicalText(result: TarotOutput, options: TarotCanonicalTextOptions = {}): string {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const birthDate = options.birthDate?.trim() || result.birthDate;
  const lines: string[] = ['# 塔罗占卜', '', '## 问卜设定', `- 牌阵: ${result.spreadName}`];
  if (result.question) lines.push(`- 问题: ${result.question}`);
  if (detailLevel === 'full' && birthDate) lines.push(`- 出生日期: ${birthDate}`);
  if (detailLevel === 'full' && result.seed) lines.push(`- 随机种子: ${result.seed}`);
  lines.push('');

  // Dynamic columns for card table
  const hasElement = result.cards.some((c) => c.element);
  const hasAstro = result.cards.some((c) => c.astrologicalCorrespondence);

  const header = ['位置', '塔罗牌', '状态'];
  if (hasElement) header.push('元素');
  if (hasAstro) header.push('星象');
  header.push('核心基调');

  lines.push('## 牌阵展开');
  lines.push('');
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${header.map(() => '------').join('|')}|`);

  for (const card of result.cards) {
    const isReversed = card.orientation === 'reversed';
    const direction = isReversed ? '逆位' : '正位';
    const toneKeywords = isReversed && card.reversedKeywords?.length ? card.reversedKeywords : card.card.keywords;
    const row = [card.position, card.card.nameChinese, direction];
    if (hasElement) row.push(card.element || '-');
    if (hasAstro) row.push(card.astrologicalCorrespondence || '-');
    row.push(toneKeywords.join('、'));
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('');

  if (detailLevel === 'full' && result.numerology) {
    lines.push('## 求问者生命数字');
    lines.push('');
    const nCards = [
      { label: '人格牌', card: result.numerology.personalityCard },
      { label: '灵魂牌', card: result.numerology.soulCard },
      { label: `年度牌(${result.numerology.yearlyCard.year})`, card: result.numerology.yearlyCard },
    ];
    lines.push('| 维度 | 对应塔罗 | 元素 | 星象 | 背景基调 |');
    lines.push('|------|----------|------|------|----------|');
    for (const { label, card } of nCards) {
      lines.push(`| ${label} | ${card.nameChinese} | ${card.element || '-'} | ${card.astrologicalCorrespondence || '-'} | ${card.keywords?.join('、') || '-'} |`);
    }
  }

  return lines.join('\n');
}
