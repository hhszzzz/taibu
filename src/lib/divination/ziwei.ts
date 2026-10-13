/**
 * 紫微斗数排盘核心逻辑
 *
 * web 侧保留展示/交互辅助，但主排盘真源来自 core。
 */

import {
    calculateZiweiDataWithAstrolabe,
    createAstrolabeWithTrueSolar,
    toZiweiJson,
    toZiweiText,
    type ZiweiCanonicalJSON,
    type ZiweiOutput as CoreZiweiOutput,
} from 'taibu-core/ziwei';
import {
    calculateZiweiHoroscopeDataWithAstrolabe,
    toZiweiHoroscopeJson,
    type ZiweiHoroscopeCanonicalJSON,
    type ZiweiHoroscopeOutput as CoreZiweiHoroscopeOutput,
} from 'taibu-core/ziwei-horoscope';
import { calculateZiweiFlyingStar } from 'taibu-core/ziwei-flying-star';
import { Lunar, Solar } from 'lunar-javascript';
import type { Gender, CalendarType } from '@/types';
import { resolveChartTextDetailLevel, type ChartTextDetailLevel } from '@/lib/divination/detail-level';
import { resolveBirthTimeOptions, type BirthTimeResolution } from '@/lib/divination/birth-time';

export type Astrolabe = ReturnType<typeof createAstrolabeWithTrueSolar>['astrolabe'];

function toCoreZiweiInput(formData: ZiweiFormData) {
    return {
        gender: formData.gender,
        birthYear: formData.birthYear,
        birthMonth: formData.birthMonth,
        birthDay: formData.birthDay,
        birthHour: formData.birthHour,
        birthMinute: formData.birthMinute,
        calendarType: formData.calendarType === 'lunar' ? 'lunar' as const : 'solar' as const,
        isLeapMonth: formData.isLeapMonth,
        longitude: formData.longitude,
        ...resolveBirthTimeOptions(formData),
    };
}

// ===== 类型定义 =====

/** 紫微斗数表单数据 */
export interface ZiweiFormData extends BirthTimeResolution {
    name: string;
    gender: Gender;
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    birthHour: number;
    birthMinute: number;
    calendarType: CalendarType;
    isLeapMonth?: boolean; // 是否闰月
    birthPlace?: string; // 出生地点（不参与排盘，仅用于存储）
    longitude?: number;
    isUnknownTime?: boolean; // 是否未知时辰
}

// ===== 常量 =====

const EARTHLY_BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

const PALACE_LAYOUT_ORDER = [
    5, 6, 7, 8,    // 巳午未申 (第一行)
    4, -1, -1, 9,  // 辰-中空-酉 (第二行)
    3, -1, -1, 10, // 卯-中空-戌 (第三行)
    2, 1, 0, 11,   // 寅丑子亥 (第四行)
];

// 宫名统一为对外的「交友」：iztro 原名为「仆役」，core 输出前已归一为「交友」
const PALACE_TEXT_ORDER = ['命宫', '兄弟', '夫妻', '子女', '财帛', '疾厄', '迁移', '交友', '官禄', '田宅', '福德', '父母'];

// ===== 主要导出函数 =====

/**
 * 按整小时平移出生时间（结果页「时辰微调」定盘用），跨日时按所选历法顺延日期；
 * 农历会正确进出闰月。日期本身无效时抛错，由调用方与排盘错误一并处理。
 */
export function shiftZiweiBirthHour(formData: ZiweiFormData, hourOffset: number): ZiweiFormData {
    if (!Number.isInteger(hourOffset) || hourOffset === 0) return formData;
    const totalHours = formData.birthHour + hourOffset;
    const dayShift = Math.floor(totalHours / 24);
    const birthHour = totalHours - dayShift * 24;
    if (dayShift === 0) return { ...formData, birthHour };

    if (formData.calendarType === 'lunar') {
        const lunarMonth = formData.isLeapMonth ? -formData.birthMonth : formData.birthMonth;
        const shifted = Lunar.fromYmd(formData.birthYear, lunarMonth, formData.birthDay).getSolar().next(dayShift).getLunar();
        return {
            ...formData,
            birthYear: shifted.getYear(),
            birthMonth: Math.abs(shifted.getMonth()),
            birthDay: shifted.getDay(),
            isLeapMonth: shifted.getMonth() < 0,
            birthHour,
        };
    }
    const shifted = Solar.fromYmd(formData.birthYear, formData.birthMonth, formData.birthDay).next(dayShift);
    return { ...formData, birthYear: shifted.getYear(), birthMonth: shifted.getMonth(), birthDay: shifted.getDay(), birthHour };
}

export function calculateZiweiChartBundle(formData: ZiweiFormData): {
    output: CoreZiweiOutput;
    astrolabe: Astrolabe;
} {
    const { output, astrolabe } = calculateZiweiDataWithAstrolabe(toCoreZiweiInput(formData));
    return {
        output,
        astrolabe,
    };
}

/**
 * 获取宫位的传统排列顺序（用于 4x3 布局）
 * 返回索引数组，按照：
 *   [巳] [午] [未] [申]
 *   [辰]         [酉]
 *   [卯]         [戌]
 *   [寅] [丑] [子] [亥]
 */
export function getPalaceLayoutOrder(): number[] {
    return PALACE_LAYOUT_ORDER;
}

/**
 * 根据地支获取宫位索引
 */
export function getBranchIndex(branch: string): number {
    return EARTHLY_BRANCHES.indexOf(branch);
}

// ===== 运限类型定义 =====

/** 运限宫位信息 */
export interface HoroscopePalaceInfo {
    index: number;
    name: string;
    heavenlyStem: string;
    earthlyBranch: string;
    mutagen?: string[];
}

/** 大限信息 */
export interface DecadalInfo {
    index: number;
    startAge: number;
    endAge: number;
    palace: HoroscopePalaceInfo;
    heavenlyStem: string;
}

/** 流年/流月/流日信息 */
export interface FlowPeriodInfo {
    period: string;  // year/month/day value
    palace: HoroscopePalaceInfo;
    heavenlyStem: string;
    earthlyBranch: string;
}

/** 完整运限数据 */
export interface ZiweiHoroscope {
    decadal: DecadalInfo;
    yearly: FlowPeriodInfo;
    monthly: FlowPeriodInfo;
    daily: FlowPeriodInfo;
}

// ===== 运限计算函数 =====

/**
 * 获取指定日期的运限信息（复用 core shared horoscope helper）
 */
export function getHoroscope(output: CoreZiweiOutput, astrolabe: Astrolabe, date: Date = new Date()): ZiweiHoroscope | null {
    try {
        const horoscope = calculateZiweiHoroscopeDataWithAstrolabe(astrolabe, {
            targetDate: date,
        });
        const decadalRange = getDecadalList(output).find((item) => item.index === horoscope.decadal.index);
        const decadal: DecadalInfo = {
            index: horoscope.decadal.index,
            startAge: decadalRange?.startAge ?? 0,
            endAge: decadalRange?.endAge ?? 0,
            palace: {
                index: horoscope.decadal.index,
                name: horoscope.decadal.name,
                heavenlyStem: horoscope.decadal.heavenlyStem,
                earthlyBranch: horoscope.decadal.earthlyBranch,
                mutagen: horoscope.decadal.mutagen,
            },
            heavenlyStem: horoscope.decadal.heavenlyStem,
        };

        const yearly: FlowPeriodInfo = {
            period: horoscope.targetDate.split('-')[0],
            palace: {
                index: horoscope.yearly.index,
                name: horoscope.yearly.name,
                heavenlyStem: horoscope.yearly.heavenlyStem,
                earthlyBranch: horoscope.yearly.earthlyBranch,
                mutagen: horoscope.yearly.mutagen,
            },
            heavenlyStem: horoscope.yearly.heavenlyStem,
            earthlyBranch: horoscope.yearly.earthlyBranch,
        };

        const monthly: FlowPeriodInfo = {
            period: String(Number(horoscope.targetDate.split('-')[1])),
            palace: {
                index: horoscope.monthly.index,
                name: horoscope.monthly.name,
                heavenlyStem: horoscope.monthly.heavenlyStem,
                earthlyBranch: horoscope.monthly.earthlyBranch,
                mutagen: horoscope.monthly.mutagen,
            },
            heavenlyStem: horoscope.monthly.heavenlyStem,
            earthlyBranch: horoscope.monthly.earthlyBranch,
        };

        const daily: FlowPeriodInfo = {
            period: horoscope.targetDate,
            palace: {
                index: horoscope.daily.index,
                name: horoscope.daily.name,
                heavenlyStem: horoscope.daily.heavenlyStem,
                earthlyBranch: horoscope.daily.earthlyBranch,
                mutagen: horoscope.daily.mutagen,
            },
            heavenlyStem: horoscope.daily.heavenlyStem,
            earthlyBranch: horoscope.daily.earthlyBranch,
        };

        return { decadal, yearly, monthly, daily };
    } catch (error) {
        console.error('获取运限信息失败:', error);
        return null;
    }
}

export function buildZiweiHoroscopeCanonicalJSON(_output: CoreZiweiOutput, astrolabe: Astrolabe, date: Date = new Date()) {
    try {
        const result = calculateZiweiHoroscopeDataWithAstrolabe(astrolabe, {
            targetDate: date,
        }) as CoreZiweiHoroscopeOutput;
        return toZiweiHoroscopeJson(result) as ZiweiHoroscopeCanonicalJSON;
    } catch (error) {
        console.error('构建紫微运限 JSON 失败:', error);
        return null;
    }
}

/** 运限落宫：本命盘宫位索引（与 canonical `十二宫位[].宫位索引` 同一坐标系）及该运限干支。 */
export interface ZiweiPeriodMarker {
    index: number;
    ganZhi: string;
}

/** 指定日期所处的大限、流年与小限；任一层无法确定时为 null。 */
export interface ZiweiCurrentPeriods {
    decadal: (ZiweiPeriodMarker & { startAge: number; endAge: number }) | null;
    yearly: ZiweiPeriodMarker | null;
    age: ZiweiPeriodMarker | null;
}

const NO_CURRENT_PERIODS: ZiweiCurrentPeriods = Object.freeze({ decadal: null, yearly: null, age: null });

/** 阳历出生日（core `solarDate` 形如 "1984-9-27"）的本地零点；无法解析时返回 null。 */
function parseSolarBirthDate(solarDate: string): Date | null {
    const [year, month, day] = solarDate.split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    return new Date(year, month - 1, day);
}

/**
 * 指定日期的大限 / 流年 / 小限落宫（用于本命盘标注「当前大限」等）。
 *
 * - 只读取运限层的 `宫位索引`（本命盘标注按索引定位宫格；宫名可直接用 core 的 `落入本命宫位`）。
 * - 出生前、或超出末个大限时，core 会给出 -1 索引与未本地化的干支，这些层统一视为无法确定。
 */
export function getZiweiCurrentPeriods(output: CoreZiweiOutput, astrolabe: Astrolabe, date: Date = new Date()): ZiweiCurrentPeriods {
    const birthDate = parseSolarBirthDate(output.solarDate);
    if (!birthDate || date.getTime() < birthDate.getTime()) return NO_CURRENT_PERIODS;

    const layers = buildZiweiHoroscopeCanonicalJSON(output, astrolabe, date)?.运限叠宫 ?? [];
    const markerOf = (level: string): ZiweiPeriodMarker | null => {
        const layer = layers.find((item) => item.层次 === level);
        if (!layer || !Number.isInteger(layer.宫位索引) || layer.宫位索引 < 0 || layer.宫位索引 > 11) return null;
        return { index: layer.宫位索引, ganZhi: layer.干支 };
    };
    const decadal = markerOf('大限');
    const range = decadal ? getDecadalList(output).find((item) => item.index === decadal.index) : undefined;
    return {
        decadal: decadal && range ? { ...decadal, startAge: range.startAge, endAge: range.endAge } : null,
        yearly: markerOf('流年'),
        age: markerOf('小限'),
    };
}

/**
 * 出生日所在的农历年，即虚岁起算年。
 *
 * core（iztro 默认配置）按「目标日农历年 − 出生农历年 + 1」计虚岁，
 * 因此虚岁 N 对应公历年 `农历出生年 + N − 1`（取年中日期，农历年与公历年一致）。
 * 正月初一前出生者的农历年早于阳历年，不能直接用阳历年推算。
 */
export function getZiweiLunarBirthYear(output: CoreZiweiOutput): number | null {
    const birthDate = parseSolarBirthDate(output.solarDate);
    if (!birthDate) return null;
    return Solar.fromYmd(birthDate.getFullYear(), birthDate.getMonth() + 1, birthDate.getDate()).getLunar().getYear();
}

// ===== 宫干飞化 =====

/** 一条宫干四化飞出：化星与其落入的本命宫名（宫名与 canonical `十二宫位[].宫位` 一致）。 */
export interface ZiweiPalaceFlight {
    mutagen: string;
    starName: string | null;
    targetPalace: string | null;
}

/** 某一宫以宫干化出的禄权科忌。 */
export interface ZiweiPalaceFlights {
    palace: string;
    ganZhi: string;
    flights: ZiweiPalaceFlight[];
}

/** 命盘上的飞化连线：飞出宫与各化落宫均为本命宫位索引。 */
export interface ZiweiFlightOverlay {
    sourceIndex: number;
    flights: Array<{ mutagen: string; starName: string | null; targetIndex: number }>;
}

/**
 * 把一宫的飞化（以宫名表示）解析为命盘宫位索引；飞出宫不在盘上时返回 null，
 * 无法对应本命宫的单条飞化被跳过。
 */
export function resolveZiweiFlightOverlay(
    palaces: ReadonlyArray<{ 宫位: string; 宫位索引?: number }>,
    entry: ZiweiPalaceFlights,
): ZiweiFlightOverlay | null {
    const indexOf = (name: string | null) => (name ? palaces.find((palace) => palace.宫位 === name)?.宫位索引 : undefined);
    const sourceIndex = indexOf(entry.palace);
    if (typeof sourceIndex !== 'number') return null;
    return {
        sourceIndex,
        flights: entry.flights.flatMap((flight) => {
            const targetIndex = indexOf(flight.targetPalace);
            return typeof targetIndex === 'number' ? [{ mutagen: flight.mutagen, starName: flight.starName, targetIndex }] : [];
        }),
    };
}

/**
 * 十二宫各自的宫干四化落宫（飞星盘），按传统宫序返回；计算真源为 core 的飞星引擎。
 */
export async function calculateZiweiPalaceFlights(formData: ZiweiFormData): Promise<ZiweiPalaceFlights[]> {
    const { results } = await calculateZiweiFlyingStar({
        ...toCoreZiweiInput(formData),
        queries: PALACE_TEXT_ORDER.map((palace) => ({ type: 'mutagedPlaces' as const, palace })),
    });
    return results.map((result, index) => ({
        palace: result.queryTarget?.palace ?? PALACE_TEXT_ORDER[index],
        ganZhi: result.sourcePalaceGanZhi ?? '',
        flights: (result.actualFlights ?? []).map((flight) => ({
            mutagen: flight.mutagen,
            starName: flight.starName ?? null,
            targetPalace: flight.targetPalace,
        })),
    }));
}

/**
 * 获取大限列表
 */
export function getDecadalList(output: CoreZiweiOutput): DecadalInfo[] {
    return output.decadalList
        .map((item, index) => {
            const palaceIndex = output.palaces.findIndex((palace) =>
                palace.name === item.palace.name && palace.earthlyBranch === item.palace.earthlyBranch
            );
            const resolvedIndex = palaceIndex >= 0 ? palaceIndex : index;
            return {
                index: resolvedIndex,
                startAge: item.startAge,
                endAge: item.endAge,
                palace: {
                    index: resolvedIndex,
                    name: item.palace.name,
                    heavenlyStem: item.heavenlyStem,
                    earthlyBranch: item.palace.earthlyBranch,
                },
                heavenlyStem: item.heavenlyStem,
            };
        })
        .sort((a, b) => a.startAge - b.startAge);
}

// ===== 三方四正 =====

/**
 * 获取宫位的三方四正索引
 */
export function getTriangleSquare(palaceIndex: number): {
    self: number;
    opposite: number;
    triangle: number[];
    square: number[];
} {
    const normalize = (i: number) => ((i % 12) + 12) % 12;
    const self = normalize(palaceIndex);
    const opposite = normalize(palaceIndex + 6);
    const left = normalize(palaceIndex + 4);
    const right = normalize(palaceIndex - 4);

    return {
        self,
        opposite,
        triangle: [self, left, right],
        square: [self, opposite, left, right],
    };
}

/**
 * 获取宫位名称对应的索引
 */
export function getPalaceIndexByName(output: CoreZiweiOutput, name: string): number {
    return output.palaces.findIndex((palace) => palace.name === name);
}

function getTraditionalTextPalaces(output: CoreZiweiOutput) {
    return [...output.palaces].sort((leftPalace, rightPalace) => {
        const left = PALACE_TEXT_ORDER.indexOf(leftPalace.name);
        const right = PALACE_TEXT_ORDER.indexOf(rightPalace.name);
        const leftOrder = left >= 0 ? left : Number.MAX_SAFE_INTEGER;
        const rightOrder = right >= 0 ? right : Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return (leftPalace.index ?? 0) - (rightPalace.index ?? 0);
    });
}

export function buildZiweiCanonicalJSON(output: CoreZiweiOutput) {
    return toZiweiJson({
        ...output,
        palaces: getTraditionalTextPalaces(output),
    }, { detailLevel: 'full' }) as ZiweiCanonicalJSON;
}

/**
 * 生成紫微命盘文字版本（用于AI分析和复制）
 */
export function generateZiweiChartText(
    output: CoreZiweiOutput,
    options: { includeHoroscope?: boolean; detailLevel?: ChartTextDetailLevel; astrolabe?: Astrolabe } = {},
): string {
    const detailLevel = resolveChartTextDetailLevel('ziwei', options.detailLevel);
    const orderedOutput: CoreZiweiOutput = {
        ...output,
        palaces: getTraditionalTextPalaces(output),
    };

    if (!options.includeHoroscope || !options.astrolabe) {
        return toZiweiText(orderedOutput, { detailLevel });
    }

    const horoscope = getHoroscope(output, options.astrolabe, new Date());
    if (!horoscope) {
        return toZiweiText(orderedOutput, { detailLevel });
    }

    return toZiweiText(orderedOutput, {
        detailLevel,
        horoscope: {
            decadal: { palaceName: horoscope.decadal.palace.name, ageRange: `${horoscope.decadal.startAge}-${horoscope.decadal.endAge}岁` },
            yearly: { palaceName: horoscope.yearly.palace.name, period: horoscope.yearly.period },
            monthly: { palaceName: horoscope.monthly.palace.name, period: horoscope.monthly.period },
            daily: { palaceName: horoscope.daily.palace.name, period: horoscope.daily.period },
        },
    });
}
