import {
  formatZiweiCanonicalLunarDate,
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  ZiweiOutput
} from './types.js';
import type {
  ZiweiCanonicalTextOptions
} from '../shared/text-options.js';

// 宫名统一为对外的「交友」：iztro 原名为「仆役」，进入本包输出前已由 normalizePalaceName 归一
const ZIWEI_PALACE_TEXT_ORDER = ['命宫', '兄弟', '夫妻', '子女', '财帛', '疾厄', '迁移', '交友', '官禄', '田宅', '福德', '父母'];

function formatStarLabel(star: { name: string; brightness?: string; mutagen?: string; selfMutagen?: string; oppositeMutagen?: string; }): string {
  let label = star.name;
  if (star.brightness) label += `(${star.brightness})`;
  if (star.mutagen) label += `[化${star.mutagen}]`;
  if (star.selfMutagen) label += `[↓${star.selfMutagen}]`;
  if (star.oppositeMutagen) label += `[↑${star.oppositeMutagen}]`;
  return label;
}

export function sortZiweiPalaces<T extends { name: string; index?: number; }>(palaces: T[]): T[] {
  return [...palaces].sort((left, right) => {
    const leftOrder = ZIWEI_PALACE_TEXT_ORDER.indexOf(left.name);
    const rightOrder = ZIWEI_PALACE_TEXT_ORDER.indexOf(right.name);
    const normalizedLeft = leftOrder >= 0 ? leftOrder : Number.MAX_SAFE_INTEGER;
    const normalizedRight = rightOrder >= 0 ? rightOrder : Number.MAX_SAFE_INTEGER;
    if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
    return (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER);
  });
}

export function renderZiweiCanonicalText(result: ZiweiOutput, options: ZiweiCanonicalTextOptions = {}): string {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  if (detailLevel === 'full') {
    return renderZiweiCanonicalFullText(result, options);
  }

  return renderZiweiCanonicalDefaultText(result, options);
}

function buildZiweiBirthMutagenLine(result: ZiweiOutput): string | undefined {
  if (!result.mutagenSummary?.length) return undefined;
  const order = new Map([
    ['禄', 0],
    ['权', 1],
    ['科', 2],
    ['忌', 3],
  ]);
  const sorted = [...result.mutagenSummary].sort((left, right) => {
    const leftOrder = order.get(left.mutagen) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.mutagen) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
  const items = sorted.map((item) => `${item.starName}化${item.mutagen}`);
  return `${items.join('、')} (${result.fourPillars.year.gan}干)`;
}

function formatZiweiPalaceName(palace: ZiweiOutput['palaces'][number]): string {
  const tags: string[] = [];
  if (palace.isBodyPalace) tags.push('身宫');
  if (palace.isOriginalPalace) tags.push('来因');
  return tags.length > 0 ? `${palace.name}(${tags.join('、')})` : palace.name;
}

function appendZiweiHoroscopeBlock(lines: string[], options: ZiweiCanonicalTextOptions): void {
  if (!options.horoscope) return;
  const h = options.horoscope;
  lines.push('');
  lines.push('## 当前运限');
  lines.push(`- 当前大限: ${h.decadal.palaceName}（${h.decadal.ageRange}）`);
  lines.push(`- 流年宫位: ${h.yearly.palaceName}（${h.yearly.period}）`);
  lines.push(`- 流月宫位: ${h.monthly.palaceName}（${h.monthly.period}）`);
  lines.push(`- 流日宫位: ${h.daily.palaceName}（${h.daily.period}）`);
}

function renderZiweiCanonicalDefaultText(result: ZiweiOutput, options: ZiweiCanonicalTextOptions = {}): string {
  const lines: string[] = ['# 紫微命盘', '', '## 基本信息'];
  if (result.gender === 'male' || result.gender === 'female') {
    lines.push(`- 性别: ${result.gender === 'male' ? '男' : '女'}`);
  }
  const lunarDate = formatZiweiCanonicalLunarDate(result) || result.lunarDate;
  lines.push(`- 阳历: ${result.solarDate}${lunarDate ? ` (农历: ${lunarDate})` : ''}`);
  lines.push(`- 四柱: ${result.fourPillars.year.gan}${result.fourPillars.year.zhi} ${result.fourPillars.month.gan}${result.fourPillars.month.zhi} ${result.fourPillars.day.gan}${result.fourPillars.day.zhi} ${result.fourPillars.hour.gan}${result.fourPillars.hour.zhi}`);
  lines.push(`- 五行局: ${result.fiveElement}`);
  lines.push(`- 命主: ${result.soul} / 身主: ${result.body}`);
  const birthMutagenLine = buildZiweiBirthMutagenLine(result);
  if (birthMutagenLine) lines.push(`- 生年四化: ${birthMutagenLine}`);
  if (result.trueSolarTimeInfo) {
    lines.push(`- 真太阳时: ${result.trueSolarTimeInfo.trueSolarTime} (钟表时间: ${result.trueSolarTimeInfo.clockTime}; 经度: ${result.trueSolarTimeInfo.longitude}°; 校正: ${result.trueSolarTimeInfo.correctionMinutes > 0 ? '+' : ''}${result.trueSolarTimeInfo.correctionMinutes}分钟)`);
  }
  lines.push('');
  lines.push('## 十二宫位全盘');
  lines.push('| 宫位 | 干支 | 大限 | 主星及四化 | 辅煞星 (吉/煞/禄/马) |');
  lines.push('|------|------|------|------------|----------------------|');
  for (const palace of sortZiweiPalaces(result.palaces)) {
    const decadal = palace.decadalRange ? `${palace.decadalRange[0]}~${palace.decadalRange[1]}` : '-';
    lines.push(`| ${formatZiweiPalaceName(palace)} | ${palace.heavenlyStem}${palace.earthlyBranch} | ${decadal} | ${palace.majorStars.map(formatStarLabel).join('、') || '-'} | ${palace.minorStars.map(formatStarLabel).join('、') || '-'} |`);
  }

  appendZiweiHoroscopeBlock(lines, options);
  return lines.join('\n');
}

function renderZiweiCanonicalFullText(result: ZiweiOutput, options: ZiweiCanonicalTextOptions = {}): string {
  const lines: string[] = ['# 紫微命盘', '', '## 基本信息'];
  if (result.gender === 'male' || result.gender === 'female') {
    lines.push(`- 性别: ${result.gender === 'male' ? '男' : '女'}`);
  }
  const lunarDate = formatZiweiCanonicalLunarDate(result) || result.lunarDate;
  lines.push(`- 阳历: ${result.solarDate}${lunarDate ? ` (农历: ${lunarDate})` : ''}`);
  lines.push(`- 四柱: ${result.fourPillars.year.gan}${result.fourPillars.year.zhi} ${result.fourPillars.month.gan}${result.fourPillars.month.zhi} ${result.fourPillars.day.gan}${result.fourPillars.day.zhi} ${result.fourPillars.hour.gan}${result.fourPillars.hour.zhi}`);
  lines.push(`- 五行局: ${result.fiveElement}`);
  lines.push(`- 命主: ${result.soul} / 身主: ${result.body}`);
  if (result.time) lines.push(`- 时辰: ${result.time}${result.timeRange ? `（${result.timeRange}）` : ''}`);
  const identityParts: string[] = [];
  if (result.douJun) identityParts.push(`斗君: ${result.douJun}`);
  if (result.lifeMasterStar) identityParts.push(`命主星: ${result.lifeMasterStar}`);
  if (result.bodyMasterStar) identityParts.push(`身主星: ${result.bodyMasterStar}`);
  if (identityParts.length > 0) lines.push(`- ${identityParts.join(' / ')}`);
  const birthMutagenLine = buildZiweiBirthMutagenLine(result);
  if (birthMutagenLine) lines.push(`- 生年四化: ${birthMutagenLine}`);
  if (result.trueSolarTimeInfo) {
    lines.push(`- 真太阳时: ${result.trueSolarTimeInfo.trueSolarTime} (钟表时间: ${result.trueSolarTimeInfo.clockTime}; 经度: ${result.trueSolarTimeInfo.longitude}°; 校正: ${result.trueSolarTimeInfo.correctionMinutes > 0 ? '+' : ''}${result.trueSolarTimeInfo.correctionMinutes}分钟)`);
    lines.push(`- 真太阳时索引: ${result.trueSolarTimeInfo.trueTimeIndex}`);
    lines.push(`- 跨日偏移: ${result.trueSolarTimeInfo.dayOffset > 0 ? `后${result.trueSolarTimeInfo.dayOffset}日` : result.trueSolarTimeInfo.dayOffset < 0 ? `前${Math.abs(result.trueSolarTimeInfo.dayOffset)}日` : '当日'}`);
  }
  lines.push('');
  lines.push('## 十二宫位全盘');
  lines.push('| 宫位 | 干支 | 大限 | 主星及四化 | 辅星 | 杂曜 | 神煞 | 流年 | 小限 |');
  lines.push('|------|------|------|------------|------|------|------|------|------|');
  for (const palace of sortZiweiPalaces(result.palaces)) {
    const palaceLabel = formatZiweiPalaceName(palace);
    const shensha = [palace.changsheng12, palace.boshi12, palace.jiangqian12, palace.suiqian12].filter(Boolean).join('、') || '-';
    const decadal = palace.decadalRange ? `${palace.decadalRange[0]}~${palace.decadalRange[1]}` : '-';
    const liuNian = palace.liuNianAges?.length ? palace.liuNianAges.join(',') : '-';
    const xiaoXian = palace.ages?.length ? palace.ages.join(',') : '-';
    lines.push(`| ${palaceLabel} | ${palace.heavenlyStem}${palace.earthlyBranch} | ${decadal} | ${palace.majorStars.map(formatStarLabel).join('、') || '-'} | ${palace.minorStars.map(formatStarLabel).join('、') || '-'} | ${(palace.adjStars || []).map(formatStarLabel).join('、') || '-'} | ${shensha} | ${liuNian} | ${xiaoXian} |`);
  }

  appendZiweiHoroscopeBlock(lines, options);
  return lines.join('\n');
}
