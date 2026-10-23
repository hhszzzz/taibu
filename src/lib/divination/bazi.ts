/**
 * 八字排盘核心逻辑
 * 
 * 使用 lunar-javascript 库进行农历和八字计算
 * 
 * 服务端组件说明：
 * - 这些函数主要在服务端运行（Server Actions）
 * - 也可以在客户端使用，lunar-javascript 支持浏览器环境
 */

import {
    calculateBazi,
    calculateBaziLiuRiData,
    calculateBaziLiuYueData,
    calculateBaziShenShaData,
    toBaziJson,
    toBaziText,
    type BaziCanonicalJSON,
    type BaziOutput as CoreBaziOutput,
} from 'taibu-core/bazi';
import { calculateBaziDayun } from 'taibu-core/bazi-dayun';
import {
    DI_ZHI as CORE_DI_ZHI,
    calculateTenGod as calculateTenGodCore,
} from 'taibu-core/utils';
import { resolveChartTextDetailLevel, type ChartTextDetailLevel } from '@/lib/divination/detail-level';
import { resolveBirthTimeOptions, type BirthTimeResolution } from '@/lib/divination/birth-time';
import {
    HIDDEN_STEM_DETAILS,
    LIU_CHONG as CORE_LIU_CHONG,
    LIU_HE as CORE_LIU_HE,
    LIU_HE_HUA,
    SAN_HE as CORE_SAN_HE,
} from 'taibu-core/data/shensha';
import type {
    BaziFormData,
    CalendarType,
    Gender,
    HiddenStemDetail,
    HeavenlyStem,
    EarthlyBranch,
    FiveElement,
    TenGod
} from '@/types';

const DI_ZHI = CORE_DI_ZHI as readonly EarthlyBranch[];

export interface BaziMeta extends BirthTimeResolution {
    longitude?: number;
    name: string;
    birthDate: string;
    birthTime: string;
    birthPlace?: string;
    gender: Gender;
    calendarType: CalendarType;
    isLeapMonth?: boolean;
    isUnknownTime?: boolean;
}

function toCoreBaziInput(formData: BaziFormData) {
    return {
        gender: formData.gender,
        birthYear: formData.birthYear,
        birthMonth: formData.birthMonth,
        birthDay: formData.birthDay,
        birthHour: formData.birthHour,
        birthMinute: formData.birthMinute,
        calendarType: formData.calendarType === 'lunar' ? 'lunar' as const : 'solar' as const,
        isLeapMonth: formData.isLeapMonth,
        birthPlace: formData.birthPlace,
        longitude: formData.longitude,
        ...resolveBirthTimeOptions(formData),
    };
}

function buildBaziMeta(formData: BaziFormData): BaziMeta {
    return {
        name: formData.name,
        birthDate: `${formData.birthYear}-${String(formData.birthMonth).padStart(2, '0')}-${String(formData.birthDay).padStart(2, '0')}`,
        birthTime: `${String(formData.birthHour).padStart(2, '0')}:${String(formData.birthMinute).padStart(2, '0')}`,
        birthPlace: formData.birthPlace,
        gender: formData.gender,
        calendarType: formData.calendarType,
        isLeapMonth: formData.isLeapMonth,
        isUnknownTime: formData.isUnknownTime,
        longitude: formData.longitude,
        ...resolveBirthTimeOptions(formData),
    };
}

export function calculateBaziChartBundle(formData: BaziFormData): {
    output: CoreBaziOutput;
    meta: BaziMeta;
} {
    const meta = buildBaziMeta(formData);
    const output = calculateBazi(toCoreBaziInput(formData));
    return {
        output,
        meta,
    };
}

/** 地支藏干表 */
export const HIDDEN_STEMS: Record<EarthlyBranch, HeavenlyStem[]> = Object.fromEntries(
    Object.entries(HIDDEN_STEM_DETAILS).map(([branch, stems]) => [
        branch,
        stems.map((item) => item.stem as HeavenlyStem),
    ]),
) as Record<EarthlyBranch, HeavenlyStem[]>;

// ===== 工具函数 =====

/**
 * 计算十神
 * @param dayStem 日主天干
 * @param targetStem 目标天干
 */
export function calculateTenGod(dayStem: HeavenlyStem, targetStem: HeavenlyStem): TenGod {
    return calculateTenGodCore(dayStem, targetStem) as TenGod;
}

// ===== 主要导出函数 =====

/**
 * 获取十神的解释
 */
/**
 * 获取日主性格特点
 */
export function getDayMasterDescription(dayMaster: HeavenlyStem): string {
    const descriptions: Record<HeavenlyStem, string> = {
        '甲': '如参天大树，正直大方，有领袖气质，但有时过于固执',
        '乙': '如花草藤蔓，柔韧灵活，善于适应，心思细腻',
        '丙': '如太阳光芒，热情开朗，光明磊落，影响力强',
        '丁': '如烛火星光，温柔细腻，内心敏感，富有艺术气质',
        '戊': '如高山大地，稳重可靠，包容厚道，值得信赖',
        '己': '如田园沃土，谦逊务实，善于培育，心地善良',
        '庚': '如刀剑利器，坚毅果断，正义感强，做事雷厉风行',
        '辛': '如珠宝首饰，精致细腻，追求完美，品味高雅',
        '壬': '如江河大海，智慧深邃，思维活跃，胸怀宽广',
        '癸': '如雨露甘霖，细腻敏感，善解人意，富有同情心',
    };
    return descriptions[dayMaster];
}

// ===== 专业排盘相关类型 =====

export interface DaYunInfo {
    startYear: number;
    startAge: number;
    ganZhi: string;
    gan: string;
    zhi: string;
    tenGod: string;
    branchTenGod: string;
    hiddenStems: HiddenStemDetail[];
    naYin: string;
    diShi: string;
    shenSha: string[];
    liuNian: LiuNianInfo[];  // 该大运内的流年
}

export interface LiuNianInfo {
    year: number;
    age: number;
    ganZhi: string;
    gan: string;
    zhi: string;
    tenGod: string;
    naYin: string;
    hiddenStems: HiddenStemDetail[];
    diShi: string;
    shenSha: string[];
}

export interface LiuYueInfo {
    month: number;  // 1-12月
    ganZhi: string;
    jieQi: string;  // 节气名
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    gan: string;
    zhi: string;
    tenGod: string;
    hiddenStems: HiddenStemDetail[];
    naYin: string;
    diShi: string;
    shenSha: string[];
}

export interface LiuRiInfo {
    date: string;  // YYYY-MM-DD
    day: number;
    ganZhi: string;
    gan: string;
    zhi: string;
    tenGod: string;
    hiddenStems: HiddenStemDetail[];
    naYin: string;
    diShi: string;
    shenSha: string[];
}

/**
 * 神煞信息（按柱分类）
 */
export interface PillarShenSha {
    year: string[];   // 年柱神煞
    month: string[];  // 月柱神煞
    day: string[];    // 日柱神煞
    hour: string[];   // 时柱神煞
}

export interface ShenShaInfo {
    /** 吉神宜趋 */
    jiShen: string[];
    /** 凶神宜忌 */
    xiongSha: string[];
    /** 今日宜 */
    dayYi: string[];
    /** 今日忌 */
    dayJi: string[];
    /** 按柱分类的神煞星 */
    pillarShenSha: PillarShenSha;
}

// ===== 三合局 (San He) 配置 =====

/** 三合局类型 */
export type SanHeJu = '申子辰合水局' | '亥卯未合木局' | '寅午戌合火局' | '巳酉丑合金局';

/** 三合局配置：三个地支组成一个五行局 */
const SAN_HE_NAMES: Record<string, SanHeJu> = {
    '水局': '申子辰合水局',
    '木局': '亥卯未合木局',
    '火局': '寅午戌合火局',
    '金局': '巳酉丑合金局',
};

export const SAN_HE_TABLE: { branches: [EarthlyBranch, EarthlyBranch, EarthlyBranch]; result: FiveElement; name: SanHeJu }[] = CORE_SAN_HE.map((item) => ({
    branches: item.branches as [EarthlyBranch, EarthlyBranch, EarthlyBranch],
    result: item.element[0] as FiveElement,
    name: SAN_HE_NAMES[item.element],
}));

/** 半合表：两个地支可以形成半合 */
export const BAN_HE_TABLE: { branches: [EarthlyBranch, EarthlyBranch]; result: FiveElement; type: 'sheng' | 'mu' }[] = [
    // 生方半合（长生+帝旺）
    { branches: ['申', '子'], result: '水', type: 'sheng' },
    { branches: ['亥', '卯'], result: '木', type: 'sheng' },
    { branches: ['寅', '午'], result: '火', type: 'sheng' },
    { branches: ['巳', '酉'], result: '金', type: 'sheng' },
    // 墓方半合（帝旺+墓）
    { branches: ['子', '辰'], result: '水', type: 'mu' },
    { branches: ['卯', '未'], result: '木', type: 'mu' },
    { branches: ['午', '戌'], result: '火', type: 'mu' },
    { branches: ['酉', '丑'], result: '金', type: 'mu' },
];

/** 六合表及合化结果 */
export const LIU_HE_TABLE: Record<EarthlyBranch, { partner: EarthlyBranch; result: FiveElement }> = Object.fromEntries(
    DI_ZHI.map((branch) => [
        branch,
        {
            partner: CORE_LIU_HE[branch] as EarthlyBranch,
            result: LIU_HE_HUA[branch] as FiveElement,
        },
    ]),
) as Record<EarthlyBranch, { partner: EarthlyBranch; result: FiveElement }>;

/** 六冲表 */
export const LIU_CHONG_TABLE: Record<EarthlyBranch, EarthlyBranch> = CORE_LIU_CHONG as Record<EarthlyBranch, EarthlyBranch>;

/**
 * 计算神煞信息（含按柱分类的神煞星）
 */
export function calculateShenSha(formData: BaziFormData): ShenShaInfo {
    const shenSha = calculateBaziShenShaData(toCoreBaziInput(formData));

    return {
        jiShen: shenSha.jiShen,
        xiongSha: shenSha.xiongSha,
        dayYi: shenSha.dayYi,
        dayJi: shenSha.dayJi,
        pillarShenSha: shenSha.pillarShenSha as PillarShenSha,
    };
}

export interface ProfessionalBaziData {
    // 纳音
    naYin: {
        year: string;
        month: string;
        day: string;
        hour: string;
    };
    // 十二长生
    diShi: {
        year: string;
        month: string;
        day: string;
        hour: string;
    };
    // 十神（天干）
    shiShenGan: {
        year: string;
        month: string;
        hour: string;
    };
    // 十神（地支藏干）
    shiShenZhi: {
        year: string[];
        month: string[];
        day: string[];
        hour: string[];
    };
    // 大运列表（每个大运包含其流年）
    daYun: DaYunInfo[];
    // 当前大运索引
    currentDaYunIndex: number;
    // 起运年龄（精确到年月日）
    startAge: number;
    // 精确起运描述（如：8年5月3天）
    startAgeDetail: string;
}

/**
 * 计算专业排盘数据
 */
export function calculateProfessionalData(
    formData: BaziFormData,
    currentYear: number = new Date().getFullYear()
): ProfessionalBaziData {
    const coreBazi = calculateBazi(toCoreBaziInput(formData));

    // 纳音
    const naYin = {
        year: coreBazi.fourPillars.year.naYin || '',
        month: coreBazi.fourPillars.month.naYin || '',
        day: coreBazi.fourPillars.day.naYin || '',
        hour: coreBazi.fourPillars.hour.naYin || '',
    };

    // 十二长生
    const diShi = {
        year: coreBazi.fourPillars.year.diShi || '',
        month: coreBazi.fourPillars.month.diShi || '',
        day: coreBazi.fourPillars.day.diShi || '',
        hour: coreBazi.fourPillars.hour.diShi || '',
    };

    // 十神（天干）
    const shiShenGan = {
        year: coreBazi.fourPillars.year.tenGod || '',
        month: coreBazi.fourPillars.month.tenGod || '',
        hour: coreBazi.fourPillars.hour.tenGod || '',
    };

    // 十神（地支藏干）
    const shiShenZhi = {
        year: coreBazi.fourPillars.year.hiddenStems.map((item) => item.tenGod),
        month: coreBazi.fourPillars.month.hiddenStems.map((item) => item.tenGod),
        day: coreBazi.fourPillars.day.hiddenStems.map((item) => item.tenGod),
        hour: coreBazi.fourPillars.hour.hiddenStems.map((item) => item.tenGod),
    };

    const coreDayun = calculateBaziDayun(toCoreBaziInput(formData));

    // 处理大运数据 - web 保留现有展示结构，但数据来源切到 core
    const daYun: DaYunInfo[] = coreDayun.list.map((dy) => ({
        startYear: dy.startYear,
        startAge: dy.startAge,
        ganZhi: dy.ganZhi,
        gan: dy.stem,
        zhi: dy.branch,
        tenGod: dy.tenGod,
        branchTenGod: dy.branchTenGod,
        hiddenStems: dy.hiddenStems.map((item) => ({
            stem: item.stem as HeavenlyStem,
            tenGod: item.tenGod,
        })) as HiddenStemDetail[],
        naYin: dy.naYin,
        diShi: dy.diShi,
        shenSha: dy.shenSha,
        liuNian: dy.liunianList.map((ln) => ({
            year: ln.year,
            age: ln.age,
            ganZhi: ln.ganZhi,
            gan: ln.gan,
            zhi: ln.zhi,
            tenGod: ln.tenGod,
            naYin: ln.nayin,
            hiddenStems: ln.hiddenStems.map((item) => ({
                stem: item.stem as HeavenlyStem,
                tenGod: item.tenGod,
            })) as HiddenStemDetail[],
            diShi: ln.diShi,
            shenSha: ln.shenSha,
        })),
    }));

    // 找到当前所在大运
    let currentDaYunIndex = daYun.findIndex((dy, index) => {
        const nextDy = daYun[index + 1];
        if (!nextDy) return dy.startYear <= currentYear;
        return dy.startYear <= currentYear && currentYear < nextDy.startYear;
    });
    if (currentDaYunIndex < 0) currentDaYunIndex = 0;

    return {
        naYin,
        diShi,
        shiShenGan,
        shiShenZhi,
        daYun,
        currentDaYunIndex,
        startAge: coreDayun.startAge,
        startAgeDetail: coreDayun.startAgeDetail,
    };
}

/**
 * 计算流月
 * 注意：立春在2月，对应寅月（正月）
 * 节气顺序：立春(寅月)->惊蛰(卯月)->清明(辰月)->立夏(巳月)->芒种(午月)->小暑(未月)
 *          ->立秋(申月)->白露(酉月)->寒露(戌月)->立冬(亥月)->大雪(子月)->小寒(丑月)
 */
export function calculateLiuYue(year: number, formData?: BaziFormData): LiuYueInfo[] {
    if (!formData) {
        return calculateBaziLiuYueData(year) as LiuYueInfo[];
    }

    const coreBazi = calculateBazi(toCoreBaziInput(formData));

    return calculateBaziLiuYueData(year, {
        dayStem: coreBazi.fourPillars.day.stem,
        dayBranch: coreBazi.fourPillars.day.branch,
        yearBranch: coreBazi.fourPillars.year.branch,
    }).map((item) => ({
        month: item.month,
        ganZhi: item.ganZhi,
        jieQi: item.jieQi,
        startDate: item.startDate,
        endDate: item.endDate,
        gan: item.gan || '',
        zhi: item.zhi || '',
        tenGod: item.tenGod || '',
        hiddenStems: (item.hiddenStems || []).map((hidden) => ({
            stem: hidden.stem as HeavenlyStem,
            tenGod: hidden.tenGod,
        })) as HiddenStemDetail[],
        naYin: item.naYin || '',
        diShi: item.diShi || '',
        shenSha: item.shenSha || [],
    }));
}

export function calculateLiuRi(startDate: string, endDate: string, formData?: BaziFormData): LiuRiInfo[] {
    if (!formData) {
        return calculateBaziLiuRiData(startDate, endDate) as LiuRiInfo[];
    }

    const coreBazi = calculateBazi(toCoreBaziInput(formData));

    return calculateBaziLiuRiData(startDate, endDate, {
        dayStem: coreBazi.fourPillars.day.stem,
        dayBranch: coreBazi.fourPillars.day.branch,
        yearBranch: coreBazi.fourPillars.year.branch,
    }).map((item) => ({
        date: item.date,
        day: item.day,
        ganZhi: item.ganZhi,
        gan: item.gan,
        zhi: item.zhi,
        tenGod: item.tenGod || '',
        hiddenStems: (item.hiddenStems || []).map((hidden) => ({
            stem: hidden.stem as HeavenlyStem,
            tenGod: hidden.tenGod,
        })) as HiddenStemDetail[],
        naYin: item.naYin || '',
        diShi: item.diShi || '',
        shenSha: item.shenSha || [],
    }));
}

type BaziDayunMeta = Pick<BaziMeta, 'birthDate' | 'birthTime' | 'gender' | 'calendarType' | 'isLeapMonth' | 'longitude' | 'timezone' | 'disambiguation'>;

export function buildBaziCanonicalJSON(
    output: CoreBaziOutput,
) {
    return toBaziJson(output, { detailLevel: 'full' }) as BaziCanonicalJSON;
}

function buildCanonicalDayunFromMeta(meta: BaziDayunMeta) {
    try {
        const [year, month, day] = meta.birthDate.split('-').map(Number);
        const [hour, minute] = meta.birthTime.split(':').map(Number);
        return calculateBaziDayun({
            gender: meta.gender,
            birthYear: year,
            birthMonth: month,
            birthDay: day,
            birthHour: hour,
            birthMinute: minute || 0,
            calendarType: meta.calendarType === 'lunar' ? 'lunar' : 'solar',
            isLeapMonth: meta.isLeapMonth,
            longitude: meta.longitude,
            ...resolveBirthTimeOptions(meta),
        });
    } catch {
        return undefined;
    }
}

type GenerateBaziChartTextOptions = {
    detailLevel?: ChartTextDetailLevel;
    name?: string;
    meta?: BaziDayunMeta;
};

/**
 * 生成八字命盘文字版本（用于AI分析和复制）
 * @param chart 八字命盘数据（自动计算大运）
 */
export function generateBaziChartText(
    output: CoreBaziOutput,
    options: GenerateBaziChartTextOptions = {},
): string {
    const dayun = options.meta ? buildCanonicalDayunFromMeta(options.meta) : undefined;
    return toBaziText(output, {
        name: options.name,
        dayun,
        detailLevel: resolveChartTextDetailLevel('bazi', options.detailLevel),
    });
}
