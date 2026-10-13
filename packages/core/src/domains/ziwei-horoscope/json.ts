import { withRulesJSON } from '../../shared/calculation-rules.js';
import { Solar } from 'lunar-javascript';
import type {
  ZiweiHoroscopeCanonicalJSON
} from './json-types.js';
import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  ZiweiHoroscopeOutput
} from './types.js';
import type {
  ZiweiHoroscopeCanonicalTextOptions
} from '../shared/text-options.js';

export const renderZiweiHoroscopeCanonicalJSON = withRulesJSON(renderZiweiHoroscopeCanonicalJSONBase);

const formatPalace = (palaceName: string) => palaceName.endsWith('宫') ? palaceName : `${palaceName}宫`;

function renderZiweiHoroscopeCanonicalJSONBase(
  result: ZiweiHoroscopeOutput,
  options: { detailLevel?: ZiweiHoroscopeCanonicalTextOptions['detailLevel']; } = {},
): ZiweiHoroscopeCanonicalJSON {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const parsedTargetDate = (() => {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(result.targetDate.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return {
      year,
      month,
      day,
      lunarMonthLabel: `农历${Solar.fromYmd(year, month, day).getLunar().getMonthInChinese()}月`,
    };
  })();
  const zodiacMap: Record<string, string> = {
    子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇',
    午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪',
  };
  const mutagenOrder = ['禄', '权', '科', '忌'] as const;
  const formatTimeNote = (layer: '大限' | '流年' | '小限' | '流月' | '流日' | '流时'): string => {
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
        const zodiac = zodiacMap[result.yearly.earthlyBranch] || '';
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
  };
  const formatMutagen = (stars: string[]) => mutagenOrder
    .map((mutagen, index) => stars[index] ? `${stars[index]}[化${mutagen}]` : null)
    .filter((value): value is string => !!value);
  const transitGroups = (() => {
    const entries = result.transitStars || [];
    const pick = (names: string[]) => entries.filter((entry) => names.includes(entry.starName)).map((entry) => `${entry.starName}(${formatPalace(entry.palaceName)})`);
    return {
      吉星分布: pick(['流禄', '流魁', '流钺', '流马']),
      煞星分布: pick(['流羊', '流陀']),
      '桃花/文星': pick(['流昌', '流曲', '流鸾', '流喜']),
    };
  })();
  const periodEntries = [
    { layer: '大限' as const, data: result.decadal },
    { layer: '流年' as const, data: result.yearly },
    { layer: '小限' as const, data: result.age },
    { layer: '流月' as const, data: result.monthly },
    { layer: '流日' as const, data: result.daily },
    ...(detailLevel === 'full' && result.hasExplicitTargetTime && result.hourly.heavenlyStem && result.hourly.earthlyBranch
      ? [{ layer: '流时' as const, data: result.hourly }]
      : []),
  ];

  const json: ZiweiHoroscopeCanonicalJSON = {
    基本信息: {
      目标日期: result.targetDate,
      五行局: result.fiveElement,
    },
    运限叠宫: periodEntries.map(({ layer, data }) => {
      const entry: ZiweiHoroscopeCanonicalJSON['运限叠宫'][number] = {
        层次: layer,
        时间段备注: formatTimeNote(layer),
        宫位索引: data.index,
        干支: `${data.heavenlyStem}${data.earthlyBranch}`,
        落入本命宫位: data.natalPalaceName ? formatPalace(data.natalPalaceName) : '-',
        运限四化: formatMutagen(data.mutagen),
      };
      if (detailLevel === 'full' && data.palaceNames.length > 0) entry.十二宫重排 = [...data.palaceNames];
      if (detailLevel === 'full' && data.stars) entry.流曜 = data.stars.flatMap((stars, palaceIndex) => stars.map(star => ({ 宫位索引: palaceIndex, 星曜: star.name, ...(star.type ? { 类型: star.type } : {}), ...(star.brightness ? { 亮度: star.brightness } : {}), ...(star.mutagen ? { 四化: star.mutagen } : {}) })));
      return entry;
    }),
  };
  if (detailLevel === 'full') {
    json.基本信息.阳历 = result.solarDate;
    json.基本信息.农历 = result.lunarDate;
    json.基本信息.命主 = result.soul;
    json.基本信息.身主 = result.body;
  }

  if (transitGroups.吉星分布.length || transitGroups.煞星分布.length || transitGroups['桃花/文星'].length) {
    json.流年星曜 = transitGroups;
  }

  if (detailLevel === 'full' && result.yearlyDecStar) {
    if (result.yearlyDecStar.suiqian12.length) json.岁前十二星 = result.yearlyDecStar.suiqian12;
    if (result.yearlyDecStar.jiangqian12.length) json.将前十二星 = result.yearlyDecStar.jiangqian12;
  }

  return json;
}

// ===== 紫微飞星 =====
