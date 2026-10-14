import { Solar } from 'lunar-javascript';
import { CoreInputError, validateCivilDateTime } from '../../shared/validation.js';
import { DEFAULT_DIVINATION_TIMEZONE, zonedWallClockToSystemDate } from '../../shared/timezone-utils.js';
import { pinyin as convertToPinyin } from 'pinyin';
import { MEIHUA_RUSHENG_CHAR_SET } from '../../data/meihua-rusheng.js';
import { GUA_CI, XIANG_CI } from '../../data/hexagrams.js';
import { calculateDerivedHexagrams, calculateGanZhiTime, findHexagram, getPalaceInfo } from '../liuyao/calculate.js';
import type {
  MeihuaBodyUseRelation,
  MeihuaCastMeta,
  MeihuaCountCategory,
  MeihuaCueCategory,
  MeihuaHexagramInfo,
  MeihuaInput,
  MeihuaInteractionReading,
  MeihuaJudgement,
  MeihuaMethod,
  MeihuaMultiSentenceStrategy,
  MeihuaOutput,
  MeihuaSeasonalState,
  MeihuaSeasonState,
  MeihuaTextSplitMode,
  MeihuaTimingHint,
  MeihuaTrigramInfo,
} from './types.js';
import type {
  DiZhi,
  GanZhiTime,
  WuXing
} from '../shared/types.js';

type MeihuaTrigramName = '乾' | '兑' | '离' | '震' | '巽' | '坎' | '艮' | '坤';
type WallClockDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type CueCatalogEntry = {
  cue: string;
  trigram: MeihuaTrigramName;
  category: MeihuaCueCategory;
  aliases?: string[];
};

type ToneCastResult =
  | { upperNumber: number; lowerNumber: number; total: number; }
  | { fallbackReason: string; };

const TRIGRAMS: Record<MeihuaTrigramName, MeihuaTrigramInfo> = {
  乾: { name: '乾', code: '111', number: 1, element: '金' },
  兑: { name: '兑', code: '110', number: 2, element: '金' },
  离: { name: '离', code: '101', number: 3, element: '火' },
  震: { name: '震', code: '100', number: 4, element: '木' },
  巽: { name: '巽', code: '011', number: 5, element: '木' },
  坎: { name: '坎', code: '010', number: 6, element: '水' },
  艮: { name: '艮', code: '001', number: 7, element: '土' },
  坤: { name: '坤', code: '000', number: 8, element: '土' },
};

const TRIGRAM_NUMBER_MAP: Record<number, MeihuaTrigramName> = {
  1: '乾',
  2: '兑',
  3: '离',
  4: '震',
  5: '巽',
  6: '坎',
  7: '艮',
  8: '坤',
};

const ALL_YANG_HEXAGRAM_CODE = '111111';
const ALL_YIN_HEXAGRAM_CODE = '000000';
const CLASSICAL_TONE_TEXT_MIN = 4;
const CLASSICAL_TONE_TEXT_MAX = 10;
const CLASSICAL_TONE_DIGIT_PATTERN = /([0-5])$/;

const YEAR_BRANCH_NUMBER: Record<string, number> = {
  鼠: 1,
  牛: 2,
  虎: 3,
  兔: 4,
  龙: 5,
  蛇: 6,
  马: 7,
  羊: 8,
  猴: 9,
  鸡: 10,
  狗: 11,
  猪: 12,
};

const BRANCH_MONTH_STATE: Record<DiZhi, Record<WuXing, MeihuaSeasonState>> = {
  寅: { 木: '旺', 火: '相', 水: '休', 金: '囚', 土: '死' },
  卯: { 木: '旺', 火: '相', 水: '休', 金: '囚', 土: '死' },
  辰: { 土: '旺', 金: '相', 火: '休', 木: '囚', 水: '死' },
  巳: { 火: '旺', 土: '相', 木: '休', 水: '囚', 金: '死' },
  午: { 火: '旺', 土: '相', 木: '休', 水: '囚', 金: '死' },
  未: { 土: '旺', 金: '相', 火: '休', 木: '囚', 水: '死' },
  申: { 金: '旺', 水: '相', 土: '休', 火: '囚', 木: '死' },
  酉: { 金: '旺', 水: '相', 土: '休', 火: '囚', 木: '死' },
  戌: { 土: '旺', 金: '相', 火: '休', 木: '囚', 水: '死' },
  亥: { 水: '旺', 木: '相', 金: '休', 土: '囚', 火: '死' },
  子: { 水: '旺', 木: '相', 金: '休', 土: '囚', 火: '死' },
  丑: { 土: '旺', 金: '相', 火: '休', 木: '囚', 水: '死' },
};

const WUXING_SHENG: Record<WuXing, WuXing> = {
  木: '火',
  火: '土',
  土: '金',
  金: '水',
  水: '木',
};

const WUXING_KE: Record<WuXing, WuXing> = {
  木: '土',
  火: '金',
  土: '水',
  金: '木',
  水: '火',
};

const METHOD_LABELS: Record<MeihuaMethod, string> = {
  time: '年月日时起卦',
  count_with_time: '物数/声数起卦',
  text_split: '字占',
  measure: '丈尺尺寸占',
  classifier_pair: '方位/常见原典类象起卦',
  select: '指定卦象',
  number_pair: '两数报数法',
  number_triplet: '三数报数法',
};

const CUE_CATALOG: CueCatalogEntry[] = [
  { cue: '乾', trigram: '乾', category: 'trigram', aliases: ['天'] },
  { cue: '兑', trigram: '兑', category: 'trigram', aliases: ['兌', '泽', '澤'] },
  { cue: '离', trigram: '离', category: 'trigram', aliases: ['火'] },
  { cue: '震', trigram: '震', category: 'trigram', aliases: ['雷'] },
  { cue: '巽', trigram: '巽', category: 'trigram', aliases: ['风', '風'] },
  { cue: '坎', trigram: '坎', category: 'trigram', aliases: ['水'] },
  { cue: '艮', trigram: '艮', category: 'trigram', aliases: ['山'] },
  { cue: '坤', trigram: '坤', category: 'trigram', aliases: ['地'] },
  { cue: '西北', trigram: '乾', category: 'direction' },
  { cue: '西', trigram: '兑', category: 'direction' },
  { cue: '南', trigram: '离', category: 'direction' },
  { cue: '东', trigram: '震', category: 'direction', aliases: ['東'] },
  { cue: '东南', trigram: '巽', category: 'direction', aliases: ['東南'] },
  { cue: '北', trigram: '坎', category: 'direction' },
  { cue: '东北', trigram: '艮', category: 'direction', aliases: ['東北'] },
  { cue: '西南', trigram: '坤', category: 'direction' },
  { cue: '红', trigram: '离', category: 'color', aliases: ['赤', '紫', '紅'] },
  { cue: '黑', trigram: '坎', category: 'color', aliases: ['玄'] },
  { cue: '白', trigram: '兑', category: 'color' },
  { cue: '青', trigram: '震', category: 'color' },
  { cue: '绿', trigram: '巽', category: 'color', aliases: ['碧', '綠'] },
  { cue: '黄', trigram: '坤', category: 'color', aliases: ['黃'] },
  { cue: '晴', trigram: '离', category: 'weather', aliases: ['日', '电', '電', '光'] },
  { cue: '雨', trigram: '坎', category: 'weather', aliases: ['雪', '露'] },
  { cue: '风', trigram: '巽', category: 'weather', aliases: ['風'] },
  { cue: '雷', trigram: '震', category: 'weather' },
  { cue: '云', trigram: '乾', category: 'weather', aliases: ['雲'] },
  { cue: '老人', trigram: '乾', category: 'person', aliases: ['老父', '父亲', '父', '君'] },
  { cue: '官贵', trigram: '乾', category: 'person', aliases: ['官贵人', '贵人'] },
  { cue: '少女', trigram: '兑', category: 'person' },
  { cue: '中女', trigram: '离', category: 'person' },
  { cue: '长男', trigram: '震', category: 'person', aliases: ['長男'] },
  { cue: '长女', trigram: '巽', category: 'person', aliases: ['長女'] },
  { cue: '中男', trigram: '坎', category: 'person' },
  { cue: '少男', trigram: '艮', category: 'person' },
  { cue: '母', trigram: '坤', category: 'person', aliases: ['老母'] },
  { cue: '老妇', trigram: '坤', category: 'person' },
  { cue: '巫', trigram: '兑', category: 'person' },
  { cue: '僧尼', trigram: '巽', category: 'person', aliases: ['僧', '尼'] },
  { cue: '童子', trigram: '艮', category: 'person' },
  { cue: '头', trigram: '乾', category: 'body', aliases: ['首'] },
  { cue: '口', trigram: '兑', category: 'body', aliases: ['舌'] },
  { cue: '目', trigram: '离', category: 'body' },
  { cue: '足', trigram: '震', category: 'body' },
  { cue: '股', trigram: '巽', category: 'body' },
  { cue: '耳', trigram: '坎', category: 'body' },
  { cue: '手', trigram: '艮', category: 'body', aliases: ['指'] },
  { cue: '腹', trigram: '坤', category: 'body', aliases: ['胃'] },
  { cue: '马', trigram: '乾', category: 'animal' },
  { cue: '羊', trigram: '兑', category: 'animal' },
  { cue: '雉', trigram: '离', category: 'animal' },
  { cue: '龙', trigram: '震', category: 'animal', aliases: ['龍'] },
  { cue: '鸡', trigram: '巽', category: 'animal', aliases: ['雞'] },
  { cue: '猪', trigram: '坎', category: 'animal', aliases: ['豕'] },
  { cue: '狗', trigram: '艮', category: 'animal' },
  { cue: '牛', trigram: '坤', category: 'animal' },
  { cue: '鱼', trigram: '坎', category: 'animal', aliases: ['魚'] },
  { cue: '龟', trigram: '离', category: 'animal', aliases: ['龜'] },
  { cue: '蟹', trigram: '离', category: 'animal' },
  { cue: '蚌', trigram: '离', category: 'animal' },
  { cue: '鳖', trigram: '离', category: 'animal', aliases: ['鱉'] },
  { cue: '鼠', trigram: '艮', category: 'animal' },
  { cue: '圆', trigram: '乾', category: 'shape', aliases: ['圓'] },
  { cue: '方', trigram: '坤', category: 'shape' },
  { cue: '文章', trigram: '坤', category: 'object' },
  { cue: '文书', trigram: '离', category: 'object', aliases: ['文書'] },
  { cue: '书', trigram: '坤', category: 'object', aliases: ['書'] },
  { cue: '水果', trigram: '乾', category: 'object' },
  { cue: '镜', trigram: '乾', category: 'object', aliases: ['鏡'] },
  { cue: '竹', trigram: '震', category: 'object' },
  { cue: '百草', trigram: '巽', category: 'object' },
  { cue: '黍稷', trigram: '坤', category: 'object', aliases: ['米谷', '米', '谷'] },
  { cue: '瓦器', trigram: '坤', category: 'object', aliases: ['瓦'] },
  { cue: '舆辇', trigram: '坤', category: 'object', aliases: ['舆', '輿', '辇', '輦'] },
  { cue: '刀', trigram: '兑', category: 'object' },
  { cue: '甲胄', trigram: '离', category: 'object' },
  { cue: '戈兵', trigram: '离', category: 'object', aliases: ['戈', '兵'] },
  { cue: '车', trigram: '震', category: 'object' },
  { cue: '绳', trigram: '巽', category: 'object', aliases: ['繩'] },
  { cue: '门', trigram: '艮', category: 'object', aliases: ['門'] },
  { cue: '布', trigram: '坤', category: 'object', aliases: ['布帛'] },
  { cue: '乐器', trigram: '震', category: 'object', aliases: ['樂器'] },
  { cue: '槁木', trigram: '离', category: 'object' },
  { cue: '蒺藜', trigram: '坎', category: 'object' },
  { cue: '盗', trigram: '坎', category: 'person' },
  { cue: '奴仆', trigram: '兑', category: 'person' },
  { cue: '花纹人', trigram: '离', category: 'person' },
];

function modToRange(value: number, base: number): number {
  const result = value % base;
  return result === 0 ? base : result;
}

const CUE_LOOKUP = new Map<string, CueCatalogEntry[]>();
for (const entry of CUE_CATALOG) {
  for (const rawCue of [entry.cue, ...(entry.aliases ?? [])]) {
    const normalizedCue = rawCue.trim().replace(/\s+/g, '');
    const current = CUE_LOOKUP.get(normalizedCue) ?? [];
    current.push(entry);
    CUE_LOOKUP.set(normalizedCue, current);
  }
}

function getHourNumber(value: Pick<WallClockDateTime, 'hour'>): number {
  return modToRange(Math.floor((value.hour + 1) / 2) + 1, 12);
}

function getTrigramByNumber(value: number): MeihuaTrigramInfo {
  const normalized = modToRange(value, 8);
  return TRIGRAMS[TRIGRAM_NUMBER_MAP[normalized]];
}

function buildHexagramCode(upper: MeihuaTrigramInfo, lower: MeihuaTrigramInfo): string {
  return `${lower.code}${upper.code}`;
}

function buildHexagramInfo(code: string): MeihuaHexagramInfo {
  const hexagram = findHexagram(code);
  if (!hexagram) {
    throw new Error(`未找到卦象: ${code}`);
  }

  return {
    name: hexagram.name,
    code: hexagram.code,
    upperTrigram: TRIGRAMS[hexagram.upperTrigram as MeihuaTrigramName],
    lowerTrigram: TRIGRAMS[hexagram.lowerTrigram as MeihuaTrigramName],
    // 卦数据的 element 是上卦五行；整卦五行取所属八宫（卷一八卦万物属类即按八宫列卦）
    element: getPalaceInfo(hexagram.code)?.element ?? (hexagram.element as WuXing),
    guaCi: GUA_CI[hexagram.name],
    xiangCi: XIANG_CI[hexagram.name],
  };
}

function buildChangedCode(code: string, movingLine: number): string {
  const chars = code.split('');
  const index = movingLine - 1;
  chars[index] = chars[index] === '1' ? '0' : '1';
  return chars.join('');
}

function buildBasicNuclearCode(code: string): string {
  return `${code.slice(1, 4)}${code.slice(2, 5)}`;
}

function buildNuclearCode(code: string, changedCode: string): string {
  if (code === ALL_YANG_HEXAGRAM_CODE || code === ALL_YIN_HEXAGRAM_CODE) {
    return buildBasicNuclearCode(changedCode);
  }
  return buildBasicNuclearCode(code);
}

function getRelation(body: WuXing, other: WuXing, stageLabel: string): MeihuaBodyUseRelation {
  if (body === other) {
    return { relation: '比和', favorable: true, summary: `${stageLabel}与体卦比和，主相助相成。` };
  }
  if (WUXING_SHENG[other] === body) {
    return { relation: '用生体', favorable: true, summary: `${stageLabel}生体，主事情助我。` };
  }
  if (WUXING_SHENG[body] === other) {
    return { relation: '体生用', favorable: false, summary: `体卦生${stageLabel}，主我去生事，多有耗泄。` };
  }
  if (WUXING_KE[body] === other) {
    return { relation: '体克用', favorable: true, summary: `体卦克${stageLabel}，主我能制事。` };
  }
  return { relation: '用克体', favorable: false, summary: `${stageLabel}克体，主事情反制于我。` };
}

function buildInteraction(stage: MeihuaInteractionReading['stage'], stageLabel: string, body: WuXing, other: WuXing): MeihuaInteractionReading {
  const relation = getRelation(body, other, stageLabel);
  return {
    stage,
    stageLabel,
    relation: relation.relation,
    favorable: relation.favorable,
    summary: relation.summary,
  };
}

function getSeasonState(monthBranch: DiZhi, element: WuXing): MeihuaSeasonState {
  return BRANCH_MONTH_STATE[monthBranch][element];
}

function normalizeStringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是字符串`);
  }
  return value;
}

function normalizeNonEmptyString(value: unknown, label: string): string {
  const trimmed = normalizeStringValue(value, label).trim();
  if (!trimmed) {
    throw new Error(`${label} 不能为空`);
  }
  return trimmed;
}

function parseWallClockDateTime(date: unknown): WallClockDateTime {
  const trimmed = normalizeNonEmptyString(date, 'date');
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    throw new Error('meihua.date 仅支持墙上时间，不支持时区偏移；请传入 YYYY-MM-DDTHH:MM[:SS]');
  }
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[T ](?<hour>\d{2}):(?<minute>\d{2})(:(?<second>\d{2}))?(\.\d{1,3})?$/.exec(trimmed);
  if (!match?.groups) {
    throw new Error('date 格式无效，必须包含时间，请使用 YYYY-MM-DDTHH:MM[:SS]');
  }

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const second = Number(match.groups.second ?? '0');

  validateCivilDateTime({ year, month, day, hour, minute, second });

  return { year, month, day, hour, minute, second };
}

function toSystemWallClockDate(input: WallClockDateTime): Date {
  return zonedWallClockToSystemDate(input, DEFAULT_DIVINATION_TIMEZONE);
}

function formatWallClockDateTime(input: WallClockDateTime): string {
  return `${String(input.year).padStart(4, '0')}-${String(input.month).padStart(2, '0')}-${String(input.day).padStart(2, '0')}T${String(input.hour).padStart(2, '0')}:${String(input.minute).padStart(2, '0')}:${String(input.second).padStart(2, '0')}`;
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} 必须是正整数`);
  }
  return value;
}

function safeSum(...values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new CoreInputError('numbers', '数值总和超出安全整数范围');
  return total;
}

function normalizeMovingLine(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 6) {
    throw new Error('movingLine 必须是 1-6 的整数');
  }
  return value;
}

function normalizeCountCategory(value?: MeihuaInput['countCategory']): MeihuaCountCategory {
  if (value === 'item' || value === 'sound') {
    return value;
  }
  if (value === undefined) {
    throw new Error('count_with_time 模式必须显式提供 countCategory（item/sound）');
  }
  throw new Error('countCategory 仅支持 item/sound');
}

function normalizeTextSplitMode(value?: MeihuaInput['textSplitMode']): MeihuaTextSplitMode {
  if (value === undefined || value === 'auto' || value === 'count' || value === 'sentence_pair' || value === 'stroke') {
    return value ?? 'auto';
  }
  throw new Error('textSplitMode 仅支持 auto/count/sentence_pair/stroke');
}

function normalizeMultiSentenceStrategy(value?: MeihuaInput['multiSentenceStrategy']): MeihuaMultiSentenceStrategy {
  if (value === 'first' || value === 'last') {
    return value;
  }
  throw new Error('multiSentenceStrategy 仅支持 first/last');
}

function normalizeCueKey(value: unknown, fieldLabel = 'value'): string {
  return normalizeNonEmptyString(value, fieldLabel).replace(/\s+/g, '');
}

function normalizeSentencePairInput(value: unknown): [string, string] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('sentence_pair 模式必须且只能提供两句文本');
  }
  const normalized = value.map((item, index) => normalizeStringValue(item, `sentences[${index}]`));
  return [normalized[0], normalized[1]];
}

function resolveCueToTrigram(value: unknown, fieldLabel: string, category?: MeihuaCueCategory): MeihuaTrigramInfo {
  const key = normalizeCueKey(value, fieldLabel);
  const candidates = (CUE_LOOKUP.get(key) ?? []).filter((entry) => !category || entry.category === category);
  const trigramNames = [...new Set(candidates.map((entry) => entry.trigram))];

  if (trigramNames.length === 0) {
    throw new Error(`${fieldLabel} 无法匹配到八卦类象: ${value}`);
  }
  if (trigramNames.length > 1) {
    throw new Error(`${fieldLabel} 类象歧义，请补充更明确的 cueCategory 或直接指定卦象: ${value} -> ${trigramNames.join('、')}`);
  }
  return TRIGRAMS[trigramNames[0]];
}

function normalizeText(value: string): string[] {
  const normalized = value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\p{Script=Han}]+/gu, '');
  return Array.from(normalized);
}

function isHanCharacter(char: string): boolean {
  return /^\p{Script=Han}$/u.test(char);
}

function splitTextBySentence(value: string): string[] {
  return value
    .split(/[。！？!?]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitUpperLowerCounts(total: number): { upperCount: number; lowerCount: number; } {
  if (total % 2 === 0) {
    return { upperCount: total / 2, lowerCount: total / 2 };
  }
  return { upperCount: Math.floor(total / 2), lowerCount: Math.ceil(total / 2) };
}

function toCountSplitNumbers(chars: string[]): { upperNumber: number; lowerNumber: number; total: number; } {
  const { upperCount, lowerCount } = splitUpperLowerCounts(chars.length);
  return {
    upperNumber: upperCount,
    lowerNumber: lowerCount,
    total: chars.length,
  };
}

function mapModernPinyinToClassicalTone(value: string): 1 | 2 | 3 | null {
  const match = CLASSICAL_TONE_DIGIT_PATTERN.exec(value);
  if (!match) return null;
  const tone = Number(match[1]);
  if (tone === 1 || tone === 2) return 1;
  if (tone === 3) return 2;
  if (tone === 4) return 3;
  return null;
}

function resolveClassicalToneValue(char: string, candidates: string[]): number | null {
  if (MEIHUA_RUSHENG_CHAR_SET.has(char)) {
    return 4;
  }

  const values = new Set<number>();
  for (const candidate of candidates) {
    const mapped = mapModernPinyinToClassicalTone(candidate);
    if (mapped === null) {
      return null;
    }
    values.add(mapped);
  }

  if (values.size !== 1) {
    return null;
  }
  return [...values][0];
}

function getPinyinPronunciations(text: string, heteronym: boolean): string[][] | null {
  const pronunciations = convertToPinyin(text, {
    style: convertToPinyin.STYLE_TONE2,
    heteronym,
    segment: true,
  });

  return Array.isArray(pronunciations) ? pronunciations : null;
}

function resolveClassicalToneNumbers(chars: string[]): ToneCastResult {
  if (chars.length < CLASSICAL_TONE_TEXT_MIN || chars.length > CLASSICAL_TONE_TEXT_MAX) {
    return { fallbackReason: '字数不在四至十字范围内' };
  }
  if (!chars.every((char) => isHanCharacter(char))) {
    return { fallbackReason: '四至十字经典字占仅适用于纯汉字文本' };
  }

  const normalizedText = chars.join('');
  const primaryPronunciations = getPinyinPronunciations(normalizedText, false);
  if (!primaryPronunciations || primaryPronunciations.length !== chars.length) {
    return { fallbackReason: '拼音切分结果与字数不一致' };
  }

  const toneValues: number[] = [];
  let ambiguousPronunciations: string[][] | null = null;
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const primaryCandidates = primaryPronunciations[index] ?? [];
    let toneValue = resolveClassicalToneValue(char, primaryCandidates);
    if (toneValue === null) {
      ambiguousPronunciations ??= getPinyinPronunciations(normalizedText, true);
      if (!ambiguousPronunciations || ambiguousPronunciations.length !== chars.length) {
        return { fallbackReason: '拼音切分结果与字数不一致' };
      }
      const candidates = ambiguousPronunciations[index] ?? [];
      toneValue = resolveClassicalToneValue(char, candidates);
    }
    if (toneValue === null) {
      return { fallbackReason: `第 ${index + 1} 字“${char}”无法稳定判定平上去入` };
    }
    toneValues.push(toneValue);
  }

  const { upperCount } = splitUpperLowerCounts(chars.length);
  const upperNumber = toneValues.slice(0, upperCount).reduce((sum, value) => sum + value, 0);
  const lowerNumber = toneValues.slice(upperCount).reduce((sum, value) => sum + value, 0);
  return {
    upperNumber,
    lowerNumber,
    total: upperNumber + lowerNumber,
  };
}

function resolveAutoTextSplitNumbers(chars: string[]): {
  upperNumber: number;
  lowerNumber: number;
  total: number;
  resolvedMode: 'tone' | 'count';
  warnings: string[];
} {
  if (chars.length === 0) {
    throw new Error('text 中缺少可计数文字');
  }
  if (chars.length === 1) {
    throw new Error('单字占请使用 stroke 模式并提供左右/上下笔画数');
  }

  const classicalToneResult = resolveClassicalToneNumbers(chars);
  if ('fallbackReason' in classicalToneResult) {
    const countNumbers = toCountSplitNumbers(chars);
    return {
      upperNumber: countNumbers.upperNumber,
      lowerNumber: countNumbers.lowerNumber,
      total: countNumbers.total,
      resolvedMode: 'count',
      warnings: chars.length >= CLASSICAL_TONE_TEXT_MIN && chars.length <= CLASSICAL_TONE_TEXT_MAX
        ? [`四至十字经典字占已回退为字数占：${classicalToneResult.fallbackReason}。`]
        : [],
    };
  }

  return {
    upperNumber: classicalToneResult.upperNumber,
    lowerNumber: classicalToneResult.lowerNumber,
    total: classicalToneResult.total,
    resolvedMode: 'tone',
    warnings: [],
  };
}

function castByTime(date: WallClockDateTime): { upper: MeihuaTrigramInfo; lower: MeihuaTrigramInfo; movingLine: number; meta: MeihuaCastMeta; } {
  const solar = Solar.fromYmdHms(date.year, date.month, date.day, date.hour, date.minute, date.second);
  const lunar = solar.getLunar();
  const yearNumber = YEAR_BRANCH_NUMBER[lunar.getYearShengXiao()] ?? 1;
  const monthNumber = Math.abs(lunar.getMonth());
  const dayNumber = lunar.getDay();
  const hourNumber = getHourNumber(date);

  const upper = getTrigramByNumber(yearNumber + monthNumber + dayNumber);
  const lower = getTrigramByNumber(yearNumber + monthNumber + dayNumber + hourNumber);
  const movingLine = modToRange(yearNumber + monthNumber + dayNumber + hourNumber, 6);

  return {
    upper,
    lower,
    movingLine,
    meta: {
      method: 'time',
      methodFamily: 'classical',
      methodLabel: METHOD_LABELS.time,
      resolvedMode: 'time',
      inputSummary: [
        `年支数=${yearNumber}`,
        `农历月=${monthNumber}`,
        `农历日=${dayNumber}`,
        `时辰数=${hourNumber}`,
      ],
      resolvedNumbers: {
        upper: modToRange(yearNumber + monthNumber + dayNumber, 8),
        lower: modToRange(yearNumber + monthNumber + dayNumber + hourNumber, 8),
        moving: movingLine,
        total: yearNumber + monthNumber + dayNumber + hourNumber,
        hour: hourNumber,
      },
    },
  };
}

function castByCountWithTime(input: MeihuaInput, date: WallClockDateTime): { upper: MeihuaTrigramInfo; lower: MeihuaTrigramInfo; movingLine: number; meta: MeihuaCastMeta; } {
  const count = normalizePositiveInteger(input.count ?? NaN, 'count');
  const hourNumber = getHourNumber(date);
  const categoryKey = normalizeCountCategory(input.countCategory);
  const upper = getTrigramByNumber(count);
  const total = safeSum(count, hourNumber);
  const lowerBase = categoryKey === 'sound' ? total : hourNumber;
  const lower = getTrigramByNumber(lowerBase);
  const movingLine = modToRange(total, 6);
  const categoryLabel = categoryKey === 'sound' ? '声音数' : '物数';

  return {
    upper,
    lower,
    movingLine,
    meta: {
      method: 'count_with_time',
      methodFamily: 'classical',
      methodLabel: METHOD_LABELS.count_with_time,
      resolvedMode: 'count_with_time',
      inputSummary: [`${categoryLabel}=${count}`, `时辰数=${hourNumber}`],
      inputSnapshot: {
        count,
        countCategory: categoryKey,
        date: formatWallClockDateTime(date),
      },
      resolvedNumbers: {
        upper: modToRange(count, 8),
        lower: modToRange(lowerBase, 8),
        moving: movingLine,
        total,
        hour: hourNumber,
      },
    },
  };
}

function castByTextSplit(input: MeihuaInput, date: WallClockDateTime): { upper: MeihuaTrigramInfo; lower: MeihuaTrigramInfo; movingLine: number; meta: MeihuaCastMeta; warnings: string[]; } {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  const mode = normalizeTextSplitMode(input.textSplitMode);
  const hasSentencePairInput = input.sentences !== undefined;
  const formattedDate = formatWallClockDateTime(date);
  if (!text && mode !== 'stroke' && !(mode === 'sentence_pair' && hasSentencePairInput)) {
    throw new Error('text_split 模式必须提供 text');
  }

  const warnings: string[] = [];
  let upperNumber = 0;
  let lowerNumber = 0;
  let total = 0;
  const hourNumber = getHourNumber(date);
  const inputSnapshot: NonNullable<MeihuaCastMeta['inputSnapshot']> = {
    date: formattedDate,
  };
  if (text) inputSnapshot.text = text;

  let resolvedMode: NonNullable<MeihuaCastMeta['resolvedMode']>;

  if (mode === 'stroke') {
    if (text) {
      const chars = normalizeText(text);
      if (chars.length !== 1) {
        throw new Error('stroke 模式如提供 text，必须是单个字');
      }
    }
    const leftStrokeCount = normalizePositiveInteger(input.leftStrokeCount ?? NaN, 'leftStrokeCount');
    const rightStrokeCount = normalizePositiveInteger(input.rightStrokeCount ?? NaN, 'rightStrokeCount');
    upperNumber = leftStrokeCount;
    lowerNumber = rightStrokeCount;
    total = safeSum(leftStrokeCount, rightStrokeCount);
    resolvedMode = 'stroke';
    inputSnapshot.leftStrokeCount = leftStrokeCount;
    inputSnapshot.rightStrokeCount = rightStrokeCount;
  } else if (mode === 'sentence_pair') {
    const sentences = input.sentences === undefined ? splitTextBySentence(text) : normalizeSentencePairInput(input.sentences);
    if (sentences.length !== 2) {
      throw new Error('sentence_pair 模式必须且只能提供两句文本');
    }
    const upperChars = normalizeText(sentences[0]);
    const lowerChars = normalizeText(sentences[1]);
    if (upperChars.length === 0 || lowerChars.length === 0) {
      throw new Error('sentence_pair 模式的两句文本都必须包含可计数字符');
    }
    upperNumber = upperChars.length;
    lowerNumber = lowerChars.length;
    total = upperNumber + lowerNumber;
    resolvedMode = 'sentence_pair';
    inputSnapshot.sentences = [...sentences];
  } else if (mode === 'auto') {
    const sentenceCandidates = splitTextBySentence(text);
    if (sentenceCandidates.length === 2) {
      upperNumber = normalizeText(sentenceCandidates[0]).length;
      lowerNumber = normalizeText(sentenceCandidates[1]).length;
      total = upperNumber + lowerNumber;
      resolvedMode = 'sentence_pair';
      inputSnapshot.sentences = [...sentenceCandidates];
    } else if (sentenceCandidates.length > 2) {
      if (input.multiSentenceStrategy === undefined) {
        throw new Error('检测到多于两句文本时，必须显式提供 multiSentenceStrategy=first/last，以确定取首句还是取末句');
      }
      const strategy = normalizeMultiSentenceStrategy(input.multiSentenceStrategy);
      const selectedSentence = strategy === 'last'
        ? sentenceCandidates[sentenceCandidates.length - 1]
        : sentenceCandidates[0];
      const resolved = resolveAutoTextSplitNumbers(normalizeText(selectedSentence));
      upperNumber = resolved.upperNumber;
      lowerNumber = resolved.lowerNumber;
      total = resolved.total;
      warnings.push(`检测到多于两句文本，auto 已按经典来意占取${strategy === 'last' ? '末句' : '首句'}；其余句不入卦。`, ...resolved.warnings);
      resolvedMode = resolved.resolvedMode;
      inputSnapshot.sentences = [...sentenceCandidates];
      inputSnapshot.selectedText = selectedSentence;
      inputSnapshot.multiSentenceStrategy = strategy;
    } else {
      const resolved = resolveAutoTextSplitNumbers(normalizeText(text));
      upperNumber = resolved.upperNumber;
      lowerNumber = resolved.lowerNumber;
      total = resolved.total;
      warnings.push(...resolved.warnings);
      resolvedMode = resolved.resolvedMode;
    }
  } else {
    const chars = normalizeText(text);
    if (chars.length === 0) {
      throw new Error('text 中缺少可计数文字');
    }
    if (chars.length === 1) {
      throw new Error('单字占请使用 stroke 模式并提供左右/上下笔画数');
    }
    const countNumbers = toCountSplitNumbers(chars);
    total = countNumbers.total;
    upperNumber = countNumbers.upperNumber;
    lowerNumber = countNumbers.lowerNumber;
    if (chars.length >= CLASSICAL_TONE_TEXT_MIN && chars.length <= CLASSICAL_TONE_TEXT_MAX && chars.every((char) => isHanCharacter(char))) {
      warnings.push('四至十字纯汉字文本可用经典平上去入法；当前按显式 count 起卦。');
    }
    resolvedMode = 'count';
  }

  const upper = getTrigramByNumber(upperNumber);
  const lower = getTrigramByNumber(lowerNumber);
  const movingLine = modToRange(safeSum(total, hourNumber), 6);

  return {
    upper,
    lower,
    movingLine,
    warnings,
    meta: {
      method: 'text_split',
      methodFamily: 'classical',
      methodLabel: METHOD_LABELS.text_split,
      resolvedMode,
      inputSummary: [`上数=${upperNumber}`, `下数=${lowerNumber}`, `总数=${total}`, `时辰数=${hourNumber}`],
      inputSnapshot,
      resolvedNumbers: {
        upper: modToRange(upperNumber, 8),
        lower: modToRange(lowerNumber, 8),
        moving: movingLine,
        total,
        hour: hourNumber,
      },
    },
  };
}

function normalizeMeasureKind(kind?: MeihuaInput['measureKind']): '丈尺' | '尺寸' {
  if (kind === '丈尺') return '丈尺';
  if (kind === '尺寸') return '尺寸';
  if (kind === undefined) {
    throw new Error('measure 模式必须显式提供 measureKind（丈尺/尺寸）');
  }
  throw new Error('measureKind 仅支持 丈尺/尺寸');
}

function castByMeasure(input: MeihuaInput, date: WallClockDateTime): { upper: MeihuaTrigramInfo; lower: MeihuaTrigramInfo; movingLine: number; meta: MeihuaCastMeta; } {
  const majorValue = normalizePositiveInteger(input.majorValue ?? NaN, 'majorValue');
  const minorValue = normalizePositiveInteger(input.minorValue ?? NaN, 'minorValue');
  const kind = normalizeMeasureKind(input.measureKind);
  const upper = getTrigramByNumber(majorValue);
  const lower = getTrigramByNumber(minorValue);
  const hourNumber = getHourNumber(date);
  const total = safeSum(majorValue, minorValue, kind === '尺寸' ? hourNumber : 0);
  const movingLine = modToRange(total, 6);

  return {
    upper,
    lower,
    movingLine,
    meta: {
      method: 'measure',
      methodFamily: 'classical',
      methodLabel: METHOD_LABELS.measure,
      resolvedMode: 'measure',
      inputSummary: [
        `${kind}上位数=${majorValue}`,
        `${kind}下位数=${minorValue}`,
        ...(kind === '尺寸' ? [`时辰数=${hourNumber}`] : []),
      ],
      inputSnapshot: {
        date: formatWallClockDateTime(date),
        measureKind: kind,
        majorValue,
        minorValue,
      },
      resolvedNumbers: {
        upper: modToRange(majorValue, 8),
        lower: modToRange(minorValue, 8),
        moving: movingLine,
        total,
        ...(kind === '尺寸' ? { hour: hourNumber } : {}),
      },
    },
  };
}

function castByClassifierPair(input: MeihuaInput, date: WallClockDateTime): { upper: MeihuaTrigramInfo; lower: MeihuaTrigramInfo; movingLine: number; meta: MeihuaCastMeta; } {
  const upperCue = input.upperCue;
  const lowerCue = input.lowerCue;
  if (!upperCue || !lowerCue) {
    throw new Error('classifier_pair 模式必须提供 upperCue 和 lowerCue');
  }
  const upper = resolveCueToTrigram(upperCue, 'upperCue', input.upperCueCategory);
  const lower = resolveCueToTrigram(lowerCue, 'lowerCue', input.lowerCueCategory);
  const hourNumber = getHourNumber(date);
  const movingLine = modToRange(upper.number + lower.number + hourNumber, 6);

  return {
    upper,
    lower,
    movingLine,
    meta: {
      method: 'classifier_pair',
      methodFamily: 'classical',
      methodLabel: METHOD_LABELS.classifier_pair,
      resolvedMode: 'classifier_pair',
      inputSummary: [
        `上卦类象=${upperCue}${input.upperCueCategory ? `（${input.upperCueCategory}）` : ''}`,
        `下卦类象=${lowerCue}${input.lowerCueCategory ? `（${input.lowerCueCategory}）` : ''}`,
        `时辰数=${hourNumber}`,
      ],
      inputSnapshot: {
        date: formatWallClockDateTime(date),
        upperCue,
        lowerCue,
        ...(input.upperCueCategory ? { upperCueCategory: input.upperCueCategory } : {}),
        ...(input.lowerCueCategory ? { lowerCueCategory: input.lowerCueCategory } : {}),
      },
      resolvedNumbers: {
        upper: upper.number,
        lower: lower.number,
        moving: movingLine,
        total: upper.number + lower.number + hourNumber,
        hour: hourNumber,
      },
    },
  };
}

function castBySelect(input: MeihuaInput, date: WallClockDateTime): { upper: MeihuaTrigramInfo; lower: MeihuaTrigramInfo; movingLine: number; meta: MeihuaCastMeta; } {
  const movingLine = normalizeMovingLine(input.movingLine ?? NaN);
  let upper: MeihuaTrigramInfo;
  let lower: MeihuaTrigramInfo;

  if (input.hexagramName) {
    const hexagram = findHexagram(input.hexagramName);
    if (!hexagram) {
      throw new Error(`未找到卦象: ${input.hexagramName}`);
    }
    upper = TRIGRAMS[hexagram.upperTrigram as MeihuaTrigramName];
    lower = TRIGRAMS[hexagram.lowerTrigram as MeihuaTrigramName];
  } else if (input.upperTrigram && input.lowerTrigram) {
    upper = resolveCueToTrigram(input.upperTrigram, 'upperTrigram');
    lower = resolveCueToTrigram(input.lowerTrigram, 'lowerTrigram');
  } else {
    throw new Error('select 模式必须提供 hexagramName，或同时提供 upperTrigram 和 lowerTrigram');
  }

  return {
    upper,
    lower,
    movingLine,
    meta: {
      method: 'select',
      methodFamily: 'classical',
      methodLabel: METHOD_LABELS.select,
      resolvedMode: 'select',
      inputSummary: [`上卦=${upper.name}`, `下卦=${lower.name}`, `动爻=${movingLine}`],
      inputSnapshot: {
        date: formatWallClockDateTime(date),
        ...(input.hexagramName ? { hexagramName: input.hexagramName } : {}),
        ...(input.upperTrigram ? { upperTrigram: input.upperTrigram } : {}),
        ...(input.lowerTrigram ? { lowerTrigram: input.lowerTrigram } : {}),
        movingLine,
      },
      resolvedNumbers: {
        upper: upper.number,
        lower: lower.number,
        moving: movingLine,
      },
    },
  };
}

function castByExtendedNumbers(input: MeihuaInput, method: 'number_pair' | 'number_triplet', date: WallClockDateTime): { upper: MeihuaTrigramInfo; lower: MeihuaTrigramInfo; movingLine: number; meta: MeihuaCastMeta; warnings: string[]; } {
  const numbers = Array.isArray(input.numbers) ? input.numbers.map((item, index) => normalizePositiveInteger(item, `numbers[${index}]`)) : [];
  const warnings = ['当前起卦使用现代报数扩展法，不属于《梅花易数》原典主线。'];
  if (method === 'number_pair') {
    if (numbers.length !== 2) {
      throw new Error('number_pair 模式必须提供 2 个数字');
    }
    const upper = getTrigramByNumber(numbers[0]);
    const lower = getTrigramByNumber(numbers[1]);
    const total = safeSum(numbers[0], numbers[1]);
    const movingLine = modToRange(total, 6);
    return {
      upper,
      lower,
      movingLine,
      warnings,
      meta: {
        method,
        methodFamily: 'extended',
        methodLabel: METHOD_LABELS[method],
        resolvedMode: method,
        inputSummary: [`第一数=${numbers[0]}`, `第二数=${numbers[1]}`],
        inputSnapshot: {
          date: formatWallClockDateTime(date),
          numbers: [...numbers],
        },
        resolvedNumbers: {
          upper: upper.number,
          lower: lower.number,
          moving: movingLine,
          total,
        },
      },
    };
  }

  if (numbers.length !== 3) {
    throw new Error('number_triplet 模式必须提供 3 个数字');
  }
  const upper = getTrigramByNumber(numbers[0]);
  const lower = getTrigramByNumber(numbers[1]);
  const movingLine = modToRange(numbers[2], 6);
  return {
    upper,
    lower,
    movingLine,
    warnings,
    meta: {
      method,
      methodFamily: 'extended',
      methodLabel: METHOD_LABELS[method],
      resolvedMode: method,
      inputSummary: [`第一数=${numbers[0]}`, `第二数=${numbers[1]}`, `第三数=${numbers[2]}`],
      inputSnapshot: {
        date: formatWallClockDateTime(date),
        numbers: [...numbers],
      },
      resolvedNumbers: {
        upper: upper.number,
        lower: lower.number,
        moving: movingLine,
        total: safeSum(...numbers),
      },
    },
  };
}

function resolveCast(input: MeihuaInput, date: WallClockDateTime): { upper: MeihuaTrigramInfo; lower: MeihuaTrigramInfo; movingLine: number; meta: MeihuaCastMeta; warnings: string[]; } {
  const method = input.method ?? 'time';
  switch (method) {
    case 'time': {
      const result = castByTime(date);
      return { ...result, warnings: [] };
    }
    case 'count_with_time': {
      const result = castByCountWithTime(input, date);
      return { ...result, warnings: [] };
    }
    case 'text_split':
      return castByTextSplit(input, date);
    case 'measure': {
      const result = castByMeasure(input, date);
      return { ...result, warnings: [] };
    }
    case 'classifier_pair': {
      const result = castByClassifierPair(input, date);
      return { ...result, warnings: [] };
    }
    case 'select': {
      const result = castBySelect(input, date);
      return { ...result, warnings: [] };
    }
    case 'number_pair':
    case 'number_triplet':
      return castByExtendedNumbers(input, method, date);
    default:
      throw new Error(`不支持的梅花起卦方式: ${method satisfies never}`);
  }
}

function buildTimingHints(readings: MeihuaInteractionReading[]): MeihuaTimingHint[] {
  const phaseMap: Record<MeihuaInteractionReading['stage'], MeihuaTimingHint['phase']> = {
    use: 'early',
    body_mutual: 'middle',
    use_mutual: 'middle',
    changed: 'late',
  };
  const triggerMap: Record<MeihuaInteractionReading['stage'], string> = {
    use: '用卦先见',
    body_mutual: '体互中见',
    use_mutual: '用互中见',
    changed: '变卦后见',
  };
  return readings.map((reading) => ({
    phase: phaseMap[reading.stage],
    trigger: triggerMap[reading.stage],
    summary: reading.favorable
      ? `${reading.stageLabel}对体卦有利，主${phaseMap[reading.stage] === 'early' ? '先应' : phaseMap[reading.stage] === 'middle' ? '中程见应' : '后应'}。`
      : `${reading.stageLabel}对体卦不利，主${phaseMap[reading.stage] === 'early' ? '先阻' : phaseMap[reading.stage] === 'middle' ? '中程受阻' : '后段反复'}。`,
  }));
}

type MeihuaStageReadings = Record<'use' | 'bodyMutual' | 'useMutual' | 'changed', MeihuaInteractionReading>;

type MeihuaVerdict = { outcome: '吉' | '凶'; summary: string; evidence: string[]; };

/**
 * 吉凶按《梅花易数》体用诸诀的先后判定，不计分：
 * 1. 卦断遗论「用不生体，互变生之而吉」「用不克体，互变俱克之而凶」：互卦有生体之卦而变卦也生体者吉，互卦有克体之卦而变卦也克体者凶；
 * 2. 牡丹占「克体之卦多矣，卦中无生意」、老人占「俱是克体，并无生气」：用、互、变中有克体之卦而无生体之卦者凶，比和与体克用都不算生气；
 * 3. 体用总诀「用吉变凶者，先吉后凶；用凶变吉者，先凶后吉」：其余按用卦与变卦对体卦的利害定始终。
 * 卷一观梅、牡丹、老人、少年、牛哀鸣、鸡悲鸣、西林寺添勾诸占与卷二乾上坤下占病六问，按体用所断都与此相合。
 */
function decideVerdict(stages: MeihuaStageReadings): MeihuaVerdict {
  const all = [stages.use, stages.bodyMutual, stages.useMutual, stages.changed];
  const mutual = [stages.bodyMutual, stages.useMutual];
  const generates = (items: MeihuaInteractionReading[]) => items.some((item) => item.relation === '用生体');
  const controls = (items: MeihuaInteractionReading[]) => items.some((item) => item.relation === '用克体');

  const mutualAndChangedGenerate = generates(mutual) && stages.changed.relation === '用生体';
  const mutualAndChangedControl = controls(mutual) && stages.changed.relation === '用克体';
  const lifeless = controls(all) && !generates(all);
  const evidence = [
    ...(mutualAndChangedGenerate ? ['互卦、变卦俱生体，愈见其吉。'] : []),
    ...(mutualAndChangedControl ? ['互卦、变卦俱克体，愈见其凶。'] : []),
    ...(lifeless ? ['卦中有克体之卦而无生体之卦，并无生气。'] : []),
  ];

  if (mutualAndChangedGenerate) return { outcome: '吉', summary: '互变俱生体，主事有成。', evidence };
  if (mutualAndChangedControl) return { outcome: '凶', summary: '互变俱克体，主事多阻。', evidence };
  if (lifeless) return { outcome: '凶', summary: '克体而无生气，主事多阻。', evidence };

  if (stages.use.favorable && !stages.changed.favorable) {
    return { outcome: '凶', summary: '先吉后凶，初看有利，后势转阻。', evidence: ['用卦吉而变卦凶，先吉后凶。'] };
  }
  if (!stages.use.favorable && stages.changed.favorable) {
    return { outcome: '吉', summary: '先凶后吉，初段多阻，后势转开。', evidence: ['用卦凶而变卦吉，先凶后吉。'] };
  }
  return stages.use.favorable
    ? { outcome: '吉', summary: '用卦、变卦俱利体卦，主事有成。', evidence: ['用卦、变卦俱利于体。'] }
    : { outcome: '凶', summary: '用卦、变卦俱不利体卦，主事多阻。', evidence: ['用卦、变卦俱不利于体。'] };
}

/** 衰旺论「体卦宜盛旺……若体衰而逢克，则其凶甚矣；体衰而有生体之卦，则衰稍解」：盛衰只论轻重，不改吉凶。 */
function describeBodySeason(state: MeihuaSeasonState, stages: MeihuaStageReadings): string {
  if (state === '旺') return '体卦月令旺，体势盛。';
  if (state !== '死') return `体卦月令${state}。`;
  const relations = Object.values(stages).map((item) => item.relation);
  const notes = [
    ...(relations.includes('用克体') ? ['逢克则其凶更甚'] : []),
    ...(relations.includes('用生体') ? ['有生体之卦则衰稍解'] : []),
  ];
  return `体卦月令死，体势衰${notes.map((note) => `，${note}`).join('')}。`;
}

/** 体用总诀「体党多而体势盛，用党多则体势衰」：互、变与体卦同五行为体党，与用卦同五行为用党。 */
function describeParty(party: { body: WuXing; use: WuXing; others: WuXing[]; }): string | null {
  const bodyCount = party.others.filter((element) => element === party.body).length;
  const useCount = party.others.filter((element) => element === party.use).length;
  if (bodyCount > useCount) return '体党多而体势盛。';
  if (useCount > bodyCount) return '用党多则体势衰。';
  return null;
}

function buildJudgement(
  stages: MeihuaStageReadings,
  bodySeason: MeihuaSeasonState,
  party: { body: WuXing; use: WuXing; others: WuXing[]; },
): MeihuaJudgement {
  const verdict = decideVerdict(stages);
  const partyNote = describeParty(party);
  return {
    outcome: verdict.outcome,
    summary: verdict.summary,
    basis: [
      ...[stages.use, stages.bodyMutual, stages.useMutual, stages.changed].map((item) => item.summary),
      ...verdict.evidence,
      describeBodySeason(bodySeason, stages),
      ...(partyNote ? [partyNote] : []),
    ],
  };
}

export function calculateMeihua(input: MeihuaInput): MeihuaOutput {
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) {
    throw new Error('请先明确问题后再起梅花卦');
  }

  const wallClock = parseWallClockDateTime(input.date);
  const analysisDate = toSystemWallClockDate(wallClock);
  const cast = resolveCast(input, wallClock);
  cast.meta.inputSnapshot = {
    date: formatWallClockDateTime(wallClock),
    ...(cast.meta.inputSnapshot ?? {}),
  };
  const mainCode = buildHexagramCode(cast.upper, cast.lower);
  const changedCode = buildChangedCode(mainCode, cast.movingLine);
  const nuclearCode = buildNuclearCode(mainCode, changedCode);

  const mainHexagram = buildHexagramInfo(mainCode);
  const changedHexagram = buildHexagramInfo(changedCode);
  const nuclearHexagramFull = buildHexagramInfo(nuclearCode);
  const { oppositeHexagram, reversedHexagram } = calculateDerivedHexagrams(mainCode);
  const ganZhiTime: GanZhiTime = calculateGanZhiTime(analysisDate);

  const bodyIsUpper = cast.movingLine <= 3;
  const bodyTrigram = bodyIsUpper ? mainHexagram.upperTrigram : mainHexagram.lowerTrigram;
  const useTrigram = bodyIsUpper ? mainHexagram.lowerTrigram : mainHexagram.upperTrigram;
  const bodyMutualTrigram = bodyIsUpper ? nuclearHexagramFull.upperTrigram : nuclearHexagramFull.lowerTrigram;
  const useMutualTrigram = bodyIsUpper ? nuclearHexagramFull.lowerTrigram : nuclearHexagramFull.upperTrigram;
  // 动爻在用卦，变卦中体卦一侧不变；体用生克论用卦变出的这一卦（观梅占「幸变为艮土，兑金得生」）
  const changedTrigram = bodyIsUpper ? changedHexagram.lowerTrigram : changedHexagram.upperTrigram;

  const bodyUseRelation = getRelation(bodyTrigram.element, useTrigram.element, '用卦');
  const stages: MeihuaStageReadings = {
    use: buildInteraction('use', '用卦', bodyTrigram.element, useTrigram.element),
    bodyMutual: buildInteraction('body_mutual', '体互', bodyTrigram.element, bodyMutualTrigram.element),
    useMutual: buildInteraction('use_mutual', '用互', bodyTrigram.element, useMutualTrigram.element),
    changed: buildInteraction('changed', '变卦', bodyTrigram.element, changedTrigram.element),
  };
  const interactionReadings = [stages.use, stages.bodyMutual, stages.useMutual, stages.changed];

  const monthBranch = ganZhiTime.month.zhi as DiZhi;
  const seasonalState: MeihuaSeasonalState = {
    monthBranch,
    body: getSeasonState(monthBranch, bodyTrigram.element),
    use: getSeasonState(monthBranch, useTrigram.element),
    bodyMutual: getSeasonState(monthBranch, bodyMutualTrigram.element),
    useMutual: getSeasonState(monthBranch, useMutualTrigram.element),
    changed: getSeasonState(monthBranch, changedTrigram.element),
  };

  const timingHints = buildTimingHints(interactionReadings);
  const judgement = buildJudgement(stages, seasonalState.body, {
    body: bodyTrigram.element,
    use: useTrigram.element,
    others: [bodyMutualTrigram.element, useMutualTrigram.element, changedTrigram.element],
  });

  return {
    question,
    castMeta: cast.meta,
    calculationOptions: { method: cast.meta.method, timezone: 'Asia/Shanghai', dayBoundary: 'zi', ruleVersion: 'meihua-2026.10' },
    ganZhiTime,
    mainHexagram,
    changedHexagram,
    nuclearHexagram: nuclearHexagramFull,
    oppositeHexagram,
    reversedHexagram,
    movingLine: cast.movingLine,
    bodyTrigram,
    useTrigram,
    bodyMutualTrigram,
    useMutualTrigram,
    changedTrigram,
    bodyUseRelation,
    seasonalState,
    interactionReadings,
    timingHints,
    judgement,
    warnings: cast.warnings,
  };
}
