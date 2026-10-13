import { withRulesText } from '../../shared/calculation-rules.js';
import { Solar } from 'lunar-javascript';
import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  HoroscopePeriodInfo,
  ZiweiHoroscopeOutput
} from './types.js';
import type {
  ZiweiHoroscopeCanonicalTextOptions
} from '../shared/text-options.js';

const ZIWEI_HOROSCOPE_MUTAGEN_ORDER = ['禄', '权', '科', '忌'] as const;
const ZIWEI_BRANCH_ZODIAC: Record<string, string> = {
  子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇',
  午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪',
};
const ZIWEI_TRANSIT_STAR_GROUPS = {
  吉星分布: ['流禄', '流魁', '流钺', '流马'],
  煞星分布: ['流羊', '流陀'],
  '桃花/文星': ['流昌', '流曲', '流鸾', '流喜'],
} as const;

function parseZiweiHoroscopeTargetDate(targetDate: string): { year: number; month: number; day: number; lunarMonthLabel: string; } | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(targetDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lunarMonthLabel = `农历${Solar.fromYmd(year, month, day).getLunar().getMonthInChinese()}月`;
  return { year, month, day, lunarMonthLabel };
}

function formatZiweiHoroscopeMutagen(stars: string[]): string {
  return ZIWEI_HOROSCOPE_MUTAGEN_ORDER
    .map((mutagen, index) => stars[index] ? `${stars[index]}[化${mutagen}]` : null)
    .filter(Boolean)
    .join(' ');
}

function formatZiweiHoroscopePalace(palaceName: string): string {
  return palaceName.endsWith('宫') ? palaceName : `${palaceName}宫`;
}

/** 运限命宫落入的本命宫（按宫位索引回查本命盘，而非运限重排后的首个宫名） */
function formatZiweiHoroscopeLandingPalace(period: HoroscopePeriodInfo): string {
  return period.natalPalaceName ? formatZiweiHoroscopePalace(period.natalPalaceName) : '-';
}

function formatZiweiHoroscopeTimeNote(
  layer: '大限' | '流年' | '小限' | '流月' | '流日' | '流时',
  result: ZiweiHoroscopeOutput,
  parsedTargetDate: ReturnType<typeof parseZiweiHoroscopeTargetDate>,
): string {
  switch (layer) {
    case '大限':
      if (typeof result.decadal.startAge === 'number' && typeof result.decadal.endAge === 'number') {
        return `虚岁 ${result.decadal.startAge}~${result.decadal.endAge}`;
      }
      return '-';
    case '流年': {
      const fallbackYear = Number(result.targetDate.slice(0, 4));
      const year = typeof parsedTargetDate?.year === 'number'
        ? parsedTargetDate.year
        : (Number.isFinite(fallbackYear) ? fallbackYear : 0);
      const zodiac = ZIWEI_BRANCH_ZODIAC[result.yearly.earthlyBranch] || '';
      return zodiac ? `${year}年 (${zodiac}年)` : `${year}年`;
    }
    case '小限':
      return `虚岁 ${result.age.nominalAge}`;
    case '流月':
      return parsedTargetDate?.lunarMonthLabel || '-';
    case '流日':
      return parsedTargetDate ? `${parsedTargetDate.day}日` : '-';
    case '流时':
      return result.hourly.earthlyBranch ? `${result.hourly.earthlyBranch}时` : '-';
    default:
      return '-';
  }
}

function buildZiweiHoroscopeTransitGroups(result: ZiweiHoroscopeOutput): Array<{ label: string; items: string[]; }> {
  const transitStars = result.transitStars || [];
  return [
    {
      label: '吉星分布',
      items: transitStars
        .filter((entry) => ZIWEI_TRANSIT_STAR_GROUPS.吉星分布.includes(entry.starName as never))
        .map((entry) => `${entry.starName}(${formatZiweiHoroscopePalace(entry.palaceName)})`),
    },
    {
      label: '煞星分布',
      items: transitStars
        .filter((entry) => ZIWEI_TRANSIT_STAR_GROUPS.煞星分布.includes(entry.starName as never))
        .map((entry) => `${entry.starName}(${formatZiweiHoroscopePalace(entry.palaceName)})`),
    },
    {
      label: '桃花/文星',
      items: transitStars
        .filter((entry) => ZIWEI_TRANSIT_STAR_GROUPS['桃花/文星'].includes(entry.starName as never))
        .map((entry) => `${entry.starName}(${formatZiweiHoroscopePalace(entry.palaceName)})`),
    },
  ];
}

export const renderZiweiHoroscopeCanonicalText = withRulesText(renderZiweiHoroscopeCanonicalTextBase);

function renderZiweiHoroscopeCanonicalTextBase(result: ZiweiHoroscopeOutput, options: ZiweiHoroscopeCanonicalTextOptions = {}): string {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const parsedTargetDate = parseZiweiHoroscopeTargetDate(result.targetDate);
  const lines: string[] = [
    '# 紫微运限',
    '',
    '## 基本信息',
    `- 目标日期: ${result.targetDate}`,
    `- 五行局: ${result.fiveElement}`,
  ];

  if (detailLevel === 'full') {
    lines.push(`- 阳历: ${result.solarDate}`);
    lines.push(`- 农历: ${result.lunarDate}`);
    lines.push(`- 命主: ${result.soul}`);
    lines.push(`- 身主: ${result.body}`);
  }

  lines.push('');
  lines.push('## 运限叠宫与四化');
  lines.push('| 层次 | 时间段/备注 | 干支 | 落入本命宫位 | 运限四化 (禄/权/科/忌) |');
  lines.push('|------|-------------|------|--------------|-------------------------|');

  const periodRows = [
    { layer: '大限' as const, data: result.decadal },
    { layer: '流年' as const, data: result.yearly },
    { layer: '小限' as const, data: result.age },
    { layer: '流月' as const, data: result.monthly },
    { layer: '流日' as const, data: result.daily },
    ...(detailLevel === 'full' && result.hasExplicitTargetTime && result.hourly.heavenlyStem && result.hourly.earthlyBranch
      ? [{ layer: '流时' as const, data: result.hourly }]
      : []),
  ];

  for (const { layer, data } of periodRows) {
    lines.push(
      `| ${layer} | ${formatZiweiHoroscopeTimeNote(layer, result, parsedTargetDate)} | ${data.heavenlyStem}${data.earthlyBranch} | ${formatZiweiHoroscopeLandingPalace(data)} | ${formatZiweiHoroscopeMutagen(data.mutagen) || '-'} |`,
    );
  }

  const transitGroups = buildZiweiHoroscopeTransitGroups(result);
  if (transitGroups.some((group) => group.items.length > 0)) {
    lines.push('');
    lines.push('## 流年星曜');
    for (const group of transitGroups) {
      if (group.items.length > 0) {
        lines.push(`- ${group.label}: ${group.items.join('、')}`);
      }
    }
  }

  if (detailLevel === 'full') {
    lines.push('', '## 各层流曜');
    for (const { layer, data } of periodRows) {
      const entries = data.stars?.flatMap((stars, index) => stars.map(star => `${star.name}${star.mutagen ? `[化${star.mutagen}]` : ''}(宫位索引${index})`)) ?? [];
      if (entries.length) lines.push(`- ${layer}: ${entries.join('、')}`);
    }
    if (result.yearlyDecStar?.suiqian12.length) {
      lines.push('');
      lines.push('## 岁前十二星');
      lines.push(result.yearlyDecStar.suiqian12.join('、'));
    }

    if (result.yearlyDecStar?.jiangqian12.length) {
      lines.push('');
      lines.push('## 将前十二星');
      lines.push(result.yearlyDecStar.jiangqian12.join('、'));
    }
  }

  return lines.join('\n');
}
