import type { ToolOutputSchema } from './contract.js';

export type OutputSchema = ToolOutputSchema;

type OutputDescriptionKind = 'string' | 'number' | 'boolean' | 'array' | 'object';

const STRING_DESCRIPTION_ALIASES: Record<string, string> = {
  问题: '占问事项',
  占问: '占问事项',
  占事: '占问事项',
  性别: '性别（男/女）',
  出生地: '出生地点',
  农历: '农历日期',
  公历: '公历日期',
  阳历: '公历日期',
  四柱: '四柱干支（年 月 日 时）',
  日主: '日主天干',
  命主五行: '日主天干及其五行',
  十神: '天干相对日主的十神',
  天干十神: '天干相对日主的十神',
  藏干十神: '藏干相对日主的十神',
  地势: '十二长生状态',
  长生十二神: '十二长生状态',
  气性: '藏干气性（本气/中气/余气）',
  纳音: '纳音五行',
  旺衰: '旺衰（旺/相/休/囚/死）',
  关系类型: '关系类型（六合、三合、六冲、相刑等）',
  是否闰月: '是否闰月（是/否）',
  钟表时间: '校正前的钟表时间',
  真太阳时: '校正后的真太阳时',
  跨日偏移: '真太阳时相对钟表时间的日期偏移（当日/前N日/后N日）',
  日干支: '当日干支',
  流日十神: '当日日干相对日主的十神',
  冲煞: '冲煞（所冲干支、生肖与煞方）',
  财神: '财神方位',
  喜神: '喜神方位',
  福神: '福神方位',
  阳贵人: '阳贵人方位',
  阴贵人: '阴贵人方位',
  天神: '黄黑道十二神',
  天神类型: '黄道或黑道',
  天神吉凶: '天神吉凶（吉/凶）',
  二十八星宿: '值日星宿（二十八宿）',
  星宿吉凶: '星宿吉凶（吉/凶）',
  建除: '建除十二神',
  黄经: '黄经（绝对黄经 / 星座内度数）',
  逆行: '逆行标记（仅逆行时为“是”）',
  相位: '相位类型（合相、六合、四分、三分、对冲等）',
  本卦: '本卦卦名',
  变卦: '变卦卦名',
  互卦: '互卦卦名',
  错卦: '错卦卦名',
  综卦: '综卦卦名',
  卦宫: '所属卦宫',
  动静: '动静状态（静/明动/暗动/日破/月破）',
  世应: '世爻或应爻',
  天将: '所乘天将',
  遁干: '遁干（无则为“-”）',
  亮度: '星曜亮度（庙/旺/得/利/平/不/陷）',
  四化: '四化（禄/权/科/忌）',
  离心自化: '离心自化：本宫宫干使本宫星曜所化的四化',
  向心自化: '向心自化：对宫宫干飞入本宫星曜所化的四化',
  元素: '对应元素',
  星象对应: '对应星体或星座',
};

const NUMBER_DESCRIPTION_ALIASES: Record<string, string> = {
  年龄: '年龄（虚岁）',
  起运年龄: '起运年龄（虚岁）',
  起始年份: '起运公历年份',
  流年年份: '流年公历年份',
  宫位索引: '宫位索引（0=寅宫，顺排至 11=丑宫）',
  校正分钟: '真太阳时相对钟表时间的校正分钟数',
  真太阳时索引: '真太阳时所在时辰序号（0=早子…12=晚子）',
  容许度: '相位容许度（度）',
  实际夹角: '实际夹角（度）',
};

const ARRAY_DESCRIPTION_ALIASES: Record<string, string> = {
  宜: '宜做事项',
  忌: '忌做事项',
  空亡: '空亡地支',
  原局关系: '与原局四柱的地支关系',
  太岁关系: '与本命太岁的关系（冲、刑、害等）',
  背景基调: '牌义关键词',
  核心基调: '当前正逆位下的牌义关键词',
  流年虚岁: '流年行经本宫时的虚岁',
  小限虚岁: '小限行经本宫时的虚岁',
};

const OBJECT_DESCRIPTION_ALIASES: Record<string, string> = {
  真太阳时: '真太阳时校正',
};

const DESCRIPTION_ALIASES = {
  string: STRING_DESCRIPTION_ALIASES,
  number: NUMBER_DESCRIPTION_ALIASES,
  boolean: {},
  array: ARRAY_DESCRIPTION_ALIASES,
  object: OBJECT_DESCRIPTION_ALIASES,
} satisfies Record<OutputDescriptionKind, Record<string, string>>;

/**
 * 统一解析输出字段描述：优先查共享词表，未命中则保留原描述。
 * JSON Schema 的 `type` 已表达值类型，因此不再追加类型后缀。
 */
function normalizeOutputDescription(kind: OutputDescriptionKind, description?: string): string | undefined {
  const trimmed = description?.trim();
  if (!trimmed) return undefined;
  const aliases: Record<string, string> = DESCRIPTION_ALIASES[kind];
  return aliases[trimmed] ?? trimmed;
}

export const str = (description?: string) => ({ type: 'string', ...(normalizeOutputDescription('string', description) ? { description: normalizeOutputDescription('string', description) } : {}) });
export const num = (description?: string) => ({ type: 'number', ...(normalizeOutputDescription('number', description) ? { description: normalizeOutputDescription('number', description) } : {}) });
export const bool = (description?: string) => ({ type: 'boolean', ...(normalizeOutputDescription('boolean', description) ? { description: normalizeOutputDescription('boolean', description) } : {}) });
export const arr = (items: Record<string, unknown>, description?: string) => ({
  type: 'array',
  items,
  ...(normalizeOutputDescription('array', description) ? { description: normalizeOutputDescription('array', description) } : {}),
});
export const obj = (properties: Record<string, unknown>, description?: string): OutputSchema => ({
  type: 'object',
  properties,
  ...(normalizeOutputDescription('object', description) ? { description: normalizeOutputDescription('object', description) } : {}),
});
