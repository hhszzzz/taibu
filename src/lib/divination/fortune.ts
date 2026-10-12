/**
 * 运势计算库
 *
 * 基于八字命理理论，通过日主与流日/流月的五行生克关系推导个性化运势。
 * 运势以等级（大吉/吉/中吉/平/小凶/凶）呈现，不使用硬性数值打分。
 * 所有推导均由天干地支的五行生克、十神、地支藏干互动等确定性规则完成，
 * 不使用任何随机数或伪随机种子。
 */

import { Solar } from 'lunar-javascript';
import type { BaziOutput as CoreBaziOutput } from 'taibu-core/bazi';
import {
    STEM_ELEMENTS,
    ZHI_WUXING,
    calculateTenGod,
    getElementRelation,
} from 'taibu-core/utils';
import {
    HIDDEN_STEM_DETAILS,
    LIU_CHONG,
    LIU_HE,
    TAO_HUA,
    YI_MA,
} from 'taibu-core/data/shensha';
import { createMemoryCache } from '@/lib/cache/memory';
import type { HeavenlyStem, FiveElement, FortuneLevel } from '@/types';

// 运势计算缓存（TTL 24h，按天不变）
const dailyFortuneCache = createMemoryCache<DailyFortune>(24 * 60 * 60 * 1000);
const monthlyFortuneCache = createMemoryCache<MonthlyFortune>(24 * 60 * 60 * 1000);

// ===== 类型定义 =====

/** 运势等级集合（用户可见） */
export interface FortuneLevels {
    overall: FortuneLevel;
    career: FortuneLevel;
    love: FortuneLevel;
    wealth: FortuneLevel;
    health: FortuneLevel;
    social: FortuneLevel;
}

/** 综合之外的五个运势维度及中文名（日运 / 月运等级条与问答上下文共用）。 */
export const FORTUNE_DIMENSIONS = [
    { key: 'career', label: '事业运' },
    { key: 'wealth', label: '财运' },
    { key: 'love', label: '感情运' },
    { key: 'health', label: '健康运' },
    { key: 'social', label: '人际运' },
] as const satisfies ReadonlyArray<{ key: Exclude<keyof FortuneLevels, 'overall'>; label: string }>;

/** 图表数值（仅用于趋势图渲染，不对用户展示） */
export interface FortuneChartScores {
    overall: number;
    career: number;
    love: number;
    wealth: number;
    health: number;
    social: number;
}

export interface DailyFortune extends FortuneLevels {
    date: string;
    dayStem: HeavenlyStem;
    dayBranch: string;
    tenGod: string;
    advice: string[];
    luckyColor: string;
    luckyDirection: string;
    /** 内部图表数值，仅供趋势图使用 */
    _chart: FortuneChartScores;
}

export interface MonthlyFortune extends FortuneLevels {
    year: number;
    month: number;
    monthStem: HeavenlyStem;
    monthBranch: string;
    tenGod: string;
    summary: string;
    keyDates: { date: number; desc: string; type?: 'lucky' | 'warning' | 'turning' }[];
    _chart: FortuneChartScores;
}

export interface EnhancedKeyDate {
    date: number;
    type: 'lucky' | 'warning' | 'turning' | 'peak' | 'valley';
    levels: FortuneLevels;
    summary: string;
    recommendation: string;
}

// ===== 等级系统 =====

const LEVEL_ORDER: FortuneLevel[] = ['凶', '小凶', '平', '中吉', '吉', '大吉'];

/** 内部权重 → 运势等级 */
function weightToLevel(w: number): FortuneLevel {
    if (w >= 85) return '大吉';
    if (w >= 75) return '吉';
    if (w >= 65) return '中吉';
    if (w >= 55) return '平';
    if (w >= 45) return '小凶';
    return '凶';
}

/** 运势等级 → 图表数值（仅供趋势图渲染） */
export function fortuneLevelToChartValue(level: FortuneLevel): number {
    const map: Record<FortuneLevel, number> = {
        '大吉': 92, '吉': 78, '中吉': 65, '平': 52, '小凶': 40, '凶': 30,
    };
    return map[level];
}

/** 比较两个等级的高低（返回 >0 表示 a 更高） */
export function compareLevels(a: FortuneLevel, b: FortuneLevel): number {
    return LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b);
}

/** 等级是否为吉（中吉及以上） */
export function isLevelFavorable(level: FortuneLevel): boolean {
    return compareLevels(level, '中吉') >= 0;
}

// ===== 常量 =====

/** 天干五行生克 → 基础权重 */
const ELEMENT_RELATION_WEIGHTS: Record<string, number> = {
    'same': 70,       // 比和：平稳
    'produce': 75,    // 我生：付出但有回报
    'produced': 85,   // 生我：贵人运
    'control': 62,    // 我克：有压力但可掌控
    'controlled': 50, // 克我：有阻力
};

/** 十神对各维度的权重调整 */
const TEN_GOD_ADJUSTMENTS: Record<string, Partial<FortuneChartScores>> = {
    '比肩': { career: 5, love: 0, wealth: -5, health: 5, social: 10 },
    '劫财': { career: 0, love: -5, wealth: -10, health: 5, social: 5 },
    '食神': { career: 5, love: 10, wealth: 5, health: 10, social: 8 },
    '伤官': { career: -5, love: 5, wealth: 5, health: 0, social: -5 },
    '偏财': { career: 5, love: 5, wealth: 15, health: 0, social: 5 },
    '正财': { career: 5, love: 10, wealth: 10, health: 0, social: 5 },
    '七杀': { career: 10, love: -5, wealth: 5, health: -5, social: -3 },
    '正官': { career: 15, love: 5, wealth: 5, health: 0, social: 8 },
    '偏印': { career: 5, love: 0, wealth: -5, health: 5, social: 0 },
    '正印': { career: 10, love: 5, wealth: 0, health: 10, social: 5 },
};

const STEM_ELEMENTS_MAP = STEM_ELEMENTS as Record<HeavenlyStem, FiveElement>;
const BRANCH_ELEMENTS = ZHI_WUXING as Record<string, FiveElement>;
const BRANCH_HIDDEN_STEMS: Record<string, HeavenlyStem[]> = Object.fromEntries(
    Object.entries(HIDDEN_STEM_DETAILS).map(([branch, stems]) => [
        branch,
        stems.map((item) => item.stem as HeavenlyStem),
    ]),
) as Record<string, HeavenlyStem[]>;
const BRANCH_CLASH: Record<string, string> = LIU_CHONG;
const BRANCH_COMBINE: Record<string, string> = LIU_HE;

const ELEMENT_COLORS: Record<FiveElement, string> = {
    '木': '绿色', '火': '红色', '土': '黄色', '金': '白色', '水': '黑色/蓝色',
};

const ELEMENT_DIRECTIONS: Record<FiveElement, string> = {
    '木': '东方', '火': '南方', '土': '中央', '金': '西方', '水': '北方',
};

// ===== 工具函数 =====

/** 限制内部权重范围 */
function clampWeight(w: number): number {
    return Math.max(30, Math.min(98, Math.round(w)));
}

/** 地支藏干对日主的综合影响（权重） */
function calcHiddenStemBonus(userDayStem: HeavenlyStem, branch: string): number {
    const hiddenStems = BRANCH_HIDDEN_STEMS[branch];
    if (!hiddenStems || hiddenStems.length === 0) return 0;
    const weights = [0.6, 0.3, 0.1];
    const userElement = STEM_ELEMENTS_MAP[userDayStem];
    let bonus = 0;
    for (let i = 0; i < hiddenStems.length; i++) {
        const stemElement = STEM_ELEMENTS_MAP[hiddenStems[i]];
        const relation = getElementRelation(userElement, stemElement);
        const w = weights[i] ?? 0.1;
        const relW: Record<string, number> = {
            'produced': 6, 'same': 3, 'produce': 1, 'control': -2, 'controlled': -5,
        };
        bonus += (relW[relation] ?? 0) * w;
    }
    return bonus;
}

/** 地支互动（六合/六冲/桃花/驿马） */
function calcBranchInteraction(
    userDayBranch: string,
    flowBranch: string
): { career: number; love: number; wealth: number; health: number; social: number } {
    const r = { career: 0, love: 0, wealth: 0, health: 0, social: 0 };
    const peachBlossomBranch = TAO_HUA[userDayBranch];
    const travelStarBranch = YI_MA[userDayBranch];
    if (BRANCH_COMBINE[userDayBranch] === flowBranch) {
        r.career += 4; r.love += 5; r.wealth += 3; r.health += 3; r.social += 5;
    }
    if (BRANCH_CLASH[userDayBranch] === flowBranch) {
        r.career -= 5; r.love -= 4; r.wealth -= 3; r.health -= 6; r.social -= 4;
    }
    if (peachBlossomBranch === flowBranch) { r.love += 4; r.social += 3; }
    if (travelStarBranch === flowBranch) { r.career += 3; r.wealth += 2; }
    return r;
}

// ===== 核心计算：内部权重 → 等级 =====

/** 计算各维度的内部权重和等级 */
function calcDimensionWeightsAndLevels(
    baseWeight: number,
    tenGod: string,
    hiddenBonus: number,
    branchBonus: { career: number; love: number; wealth: number; health: number; social: number }
): { levels: FortuneLevels; chart: FortuneChartScores } {
    const adj = TEN_GOD_ADJUSTMENTS[tenGod] || {};
    const cw = clampWeight(baseWeight + (adj.career || 0) + hiddenBonus + branchBonus.career);
    const lw = clampWeight(baseWeight + (adj.love || 0) + hiddenBonus + branchBonus.love);
    const ww = clampWeight(baseWeight + (adj.wealth || 0) + hiddenBonus + branchBonus.wealth);
    const hw = clampWeight(baseWeight + (adj.health || 0) + hiddenBonus + branchBonus.health);
    const sw = clampWeight(baseWeight + (adj.social || 0) + hiddenBonus + branchBonus.social);
    const ow = clampWeight((cw + lw + ww + hw + sw) / 5);

    return {
        levels: {
            overall: weightToLevel(ow),
            career: weightToLevel(cw),
            love: weightToLevel(lw),
            wealth: weightToLevel(ww),
            health: weightToLevel(hw),
            social: weightToLevel(sw),
        },
        chart: { overall: ow, career: cw, love: lw, wealth: ww, health: hw, social: sw },
    };
}

function getLuckyElement(userElement: FiveElement): FiveElement {
    const order: FiveElement[] = ['木', '火', '土', '金', '水'];
    const idx = order.indexOf(userElement);
    return order[(idx + 4) % 5];
}

// ===== 主要导出函数 =====

/**
 * 计算每日个性化运势
 *
 * 推导流程：
 * 1. 天干五行生克 → 基础权重
 * 2. 十神 → 维度调整
 * 3. 地支藏干 → 综合影响
 * 4. 地支互动（六合/六冲/桃花/驿马）
 * 5. 权重 → FortuneLevel
 */
export function calculateDailyFortune(baziOutput: CoreBaziOutput, date: Date): DailyFortune {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const cacheKey = `${baziOutput.dayMaster}-${baziOutput.fourPillars.day.stem}-${baziOutput.fourPillars.day.branch}-${dateStr}`;
    const cached = dailyFortuneCache.get(cacheKey);
    if (cached) return cached;

    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();
    const eightChar = lunar.getEightChar();

    const dayStem = eightChar.getDayGan() as HeavenlyStem;
    const dayBranch = eightChar.getDayZhi() as string;
    const userDayStem = baziOutput.dayMaster as HeavenlyStem;
    const userDayBranch = baziOutput.fourPillars.day.branch as string;

    const relation = getElementRelation(STEM_ELEMENTS_MAP[userDayStem], STEM_ELEMENTS_MAP[dayStem]);
    const baseWeight = ELEMENT_RELATION_WEIGHTS[relation];
    const tenGod = calculateTenGod(userDayStem, dayStem);
    const hiddenBonus = calcHiddenStemBonus(userDayStem, dayBranch);
    const branchBonus = userDayBranch
        ? calcBranchInteraction(userDayBranch, dayBranch)
        : { career: 0, love: 0, wealth: 0, health: 0, social: 0 };

    const { levels, chart } = calcDimensionWeightsAndLevels(baseWeight, tenGod, hiddenBonus, branchBonus);
    const advice = generateDailyAdvice(tenGod, levels);
    const userElement = STEM_ELEMENTS_MAP[userDayStem];
    const luckyElement = getLuckyElement(userElement);

    const result: DailyFortune = {
        date: dateStr,
        dayStem,
        dayBranch,
        tenGod,
        ...levels,
        advice,
        luckyColor: ELEMENT_COLORS[luckyElement],
        luckyDirection: ELEMENT_DIRECTIONS[luckyElement],
        _chart: chart,
    };
    dailyFortuneCache.set(cacheKey, result);
    return result;
}

/**
 * 计算每月个性化运势
 */
export function calculateMonthlyFortune(baziOutput: CoreBaziOutput, year: number, month: number): MonthlyFortune {
    const monthlyCacheKey = `${baziOutput.dayMaster}-${baziOutput.fourPillars.day.stem}-${baziOutput.fourPillars.day.branch}-${year}-${month}`;
    const monthlyCached = monthlyFortuneCache.get(monthlyCacheKey);
    if (monthlyCached) return monthlyCached;

    const solar = Solar.fromYmd(year, month, 15);
    const lunar = solar.getLunar();
    const eightChar = lunar.getEightChar();

    const monthStem = eightChar.getMonthGan() as HeavenlyStem;
    const monthBranch = eightChar.getMonthZhi() as string;
    const userDayStem = baziOutput.dayMaster as HeavenlyStem;
    const userDayBranch = baziOutput.fourPillars.day.branch as string;

    const tenGod = calculateTenGod(userDayStem, monthStem);
    const relation = getElementRelation(STEM_ELEMENTS_MAP[userDayStem], STEM_ELEMENTS_MAP[monthStem]);
    const baseWeight = ELEMENT_RELATION_WEIGHTS[relation];
    const hiddenBonus = calcHiddenStemBonus(userDayStem, monthBranch);
    const branchBonus = userDayBranch
        ? calcBranchInteraction(userDayBranch, monthBranch)
        : { career: 0, love: 0, wealth: 0, health: 0, social: 0 };

    const { levels, chart } = calcDimensionWeightsAndLevels(baseWeight, tenGod, hiddenBonus, branchBonus);
    const summary = generateMonthlySummary(tenGod, levels.overall);
    const keyDates = generateKeyDates(baziOutput, year, month);

    const monthlyResult: MonthlyFortune = {
        year, month, monthStem, monthBranch, tenGod,
        ...levels,
        summary,
        keyDates,
        _chart: chart,
    };
    monthlyFortuneCache.set(monthlyCacheKey, monthlyResult);
    return monthlyResult;
}

/**
 * 通用每日运势（无八字时使用）
 */
export function calculateGenericDailyFortune(date: Date): FortuneLevels & { advice: string[]; _chart: FortuneChartScores } {
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();
    const eightChar = lunar.getEightChar();
    const dayStem = eightChar.getDayGan() as HeavenlyStem;
    const dayBranch = eightChar.getDayZhi() as string;

    const stemElement = STEM_ELEMENTS_MAP[dayStem];
    const stemBaseMap: Record<FiveElement, number> = {
        '木': 72, '火': 68, '土': 75, '金': 70, '水': 73,
    };
    const base = stemBaseMap[stemElement] ?? 70;
    const branchElement = BRANCH_ELEMENTS[dayBranch];
    const branchAdj: Record<FiveElement, Partial<FortuneChartScores>> = {
        '木': { career: 3, love: 2, wealth: 0, health: 4, social: 1 },
        '火': { career: 2, love: 4, wealth: 1, health: -2, social: 3 },
        '土': { career: 1, love: 0, wealth: 3, health: 3, social: 0 },
        '金': { career: 4, love: -1, wealth: 4, health: 1, social: -1 },
        '水': { career: 0, love: 3, wealth: 2, health: 2, social: 4 },
    };
    const adj = branchElement ? (branchAdj[branchElement] ?? {}) : {};

    const cw = clampWeight(base + (adj.career || 0));
    const lw = clampWeight(base + (adj.love || 0));
    const ww = clampWeight(base + (adj.wealth || 0));
    const hw = clampWeight(base + (adj.health || 0));
    const sw = clampWeight(base + (adj.social || 0));
    const ow = clampWeight((cw + lw + ww + hw + sw) / 5);

    const levels: FortuneLevels = {
        overall: weightToLevel(ow), career: weightToLevel(cw), love: weightToLevel(lw),
        wealth: weightToLevel(ww), health: weightToLevel(hw), social: weightToLevel(sw),
    };

    const advice = [
        isLevelFavorable(levels.overall) ? '整体运势良好，适合开展新计划' : '今日宜稳健行事，不宜冒进',
        isLevelFavorable(levels.career) ? '工作上有贵人相助，把握机会' : '职场上需多加耐心，避免冲突',
        isLevelFavorable(levels.wealth) ? '财运亨通，可适当投资' : '守财为主，避免大额消费',
        isLevelFavorable(levels.health) ? '精力充沛，适合运动健身' : '注意休息，避免过度劳累',
    ];

    return { ...levels, advice, _chart: { overall: ow, career: cw, love: lw, wealth: ww, health: hw, social: sw } };
}

/**
 * 通用月度运势（无八字时使用）
 */
export function calculateGenericMonthlyFortune(year: number, month: number): FortuneLevels & { summary: string; _chart: FortuneChartScores } {
    const solar = Solar.fromYmd(year, month, 15);
    const lunar = solar.getLunar();
    const eightChar = lunar.getEightChar();
    const monthStem = eightChar.getMonthGan() as HeavenlyStem;
    const monthBranch = eightChar.getMonthZhi() as string;

    const stemElement = STEM_ELEMENTS_MAP[monthStem];
    const stemBaseMap: Record<FiveElement, number> = {
        '木': 72, '火': 68, '土': 75, '金': 70, '水': 73,
    };
    const base = stemBaseMap[stemElement] ?? 70;
    const branchElement = BRANCH_ELEMENTS[monthBranch];
    const branchAdj: Record<FiveElement, Partial<FortuneChartScores>> = {
        '木': { career: 3, love: 2, wealth: 0, health: 4, social: 1 },
        '火': { career: 2, love: 4, wealth: 1, health: -2, social: 3 },
        '土': { career: 1, love: 0, wealth: 3, health: 3, social: 0 },
        '金': { career: 4, love: -1, wealth: 4, health: 1, social: -1 },
        '水': { career: 0, love: 3, wealth: 2, health: 2, social: 4 },
    };
    const adj = branchElement ? (branchAdj[branchElement] ?? {}) : {};

    const cw = clampWeight(base + (adj.career || 0));
    const lw = clampWeight(base + (adj.love || 0));
    const ww = clampWeight(base + (adj.wealth || 0));
    const hw = clampWeight(base + (adj.health || 0));
    const sw = clampWeight(base + (adj.social || 0));
    const ow = clampWeight((cw + lw + ww + hw + sw) / 5);

    const levels: FortuneLevels = {
        overall: weightToLevel(ow), career: weightToLevel(cw), love: weightToLevel(lw),
        wealth: weightToLevel(ww), health: weightToLevel(hw), social: weightToLevel(sw),
    };

    const summary = isLevelFavorable(levels.overall)
        ? '本月整体运势偏强，适合稳步推进重点事项。'
        : '本月宜稳中求进，先把基础打牢。';

    return { ...levels, summary, _chart: { overall: ow, career: cw, love: lw, wealth: ww, health: hw, social: sw } };
}

// ===== 辅助函数 =====

function generateDailyAdvice(tenGod: string, levels: FortuneLevels): string[] {
    const advice: string[] = [];
    const tenGodAdvice: Record<string, string> = {
        '比肩': '今日适合与朋友合作，互帮互助',
        '劫财': '注意财务支出，避免借贷',
        '食神': '创意灵感丰富，适合发挥才华',
        '伤官': '思维活跃但需谨言慎行',
        '偏财': '有意外之财，可适当投资',
        '正财': '正财运佳，努力工作有回报',
        '七杀': '压力较大，但挑战中有机遇',
        '正官': '贵人运旺，适合拓展人脉',
        '偏印': '适合学习研究，提升自我',
        '正印': '长辈相助，学业事业顺遂',
    };
    advice.push(tenGodAdvice[tenGod] || '顺其自然，平常心对待');

    if (compareLevels(levels.overall, '吉') >= 0) {
        advice.push('整体运势极佳，可大胆行动');
    } else if (compareLevels(levels.overall, '平') < 0) {
        advice.push('今日宜静不宜动，稳健为上');
    }
    if (compareLevels(levels.career, '吉') >= 0) {
        advice.push('事业运强劲，把握晋升机会');
    } else if (compareLevels(levels.career, '平') < 0) {
        advice.push('职场需低调行事，避免冲突');
    }
    if (compareLevels(levels.wealth, '平') < 0) {
        advice.push('财运平平，不宜大额消费投资');
    }
    if (compareLevels(levels.health, '平') < 0) {
        advice.push('注意休息，避免过度劳累');
    }
    return advice.slice(0, 4);
}

function generateMonthlySummary(tenGod: string, overall: FortuneLevel): string {
    const tenGodSummary: Record<string, string> = {
        '比肩': '本月人际关系活跃，适合团队合作',
        '劫财': '本月财务需谨慎，防止意外支出',
        '食神': '本月创意运势佳，适合发展副业',
        '伤官': '本月思维活跃，但需注意言行',
        '偏财': '本月偏财运旺，可尝试投资',
        '正财': '本月正财稳定，努力有回报',
        '七杀': '本月挑战与机遇并存，需果断行动',
        '正官': '本月事业运强，贵人相助',
        '偏印': '本月适合学习进修，提升能力',
        '正印': '本月稳健发展，长辈贵人相助',
    };
    let summary = tenGodSummary[tenGod] || '本月运势平稳，顺其自然';
    if (compareLevels(overall, '吉') >= 0) {
        summary += '。整体运势极佳，可积极把握机会。';
    } else if (compareLevels(overall, '中吉') >= 0) {
        summary += '。运势良好，稳步前进即可。';
    } else {
        summary += '。建议稳健行事，避免冒险。';
    }
    return summary;
}

function generateKeyDates(baziOutput: CoreBaziOutput, year: number, month: number): { date: number; desc: string; type?: 'lucky' | 'warning' | 'turning' }[] {
    const keyDates: { date: number; desc: string; type?: 'lucky' | 'warning' | 'turning' }[] = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyData: { day: number; levels: FortuneLevels; chart: FortuneChartScores }[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month - 1, day);
        const f = calculateDailyFortune(baziOutput, d);
        dailyData.push({ day, levels: { overall: f.overall, career: f.career, love: f.love, wealth: f.wealth, health: f.health, social: f.social }, chart: f._chart });
    }

    // 识别吉日
    for (const d of dailyData) {
        if (keyDates.length >= 8) break;
        if (d.levels.overall === '大吉') {
            keyDates.push({ date: d.day, desc: '大吉日', type: 'lucky' });
        } else if (d.levels.wealth === '大吉') {
            keyDates.push({ date: d.day, desc: '财运日', type: 'lucky' });
        } else if (d.levels.career === '大吉') {
            keyDates.push({ date: d.day, desc: '事业吉日', type: 'lucky' });
        } else if (d.levels.love === '大吉') {
            keyDates.push({ date: d.day, desc: '桃花日', type: 'lucky' });
        }
    }

    // 识别转折日
    for (let i = 1; i < dailyData.length - 1; i++) {
        if (keyDates.length >= 10) break;
        const prev = dailyData[i - 1];
        const next = dailyData[i + 1];
        if (!isLevelFavorable(prev.levels.overall) && isLevelFavorable(next.levels.overall)) {
            if (!keyDates.find(k => k.date === next.day)) {
                keyDates.push({ date: next.day, desc: '转运日', type: 'turning' });
            }
        }
        if (isLevelFavorable(prev.levels.overall) && !isLevelFavorable(next.levels.overall)) {
            if (!keyDates.find(k => k.date === next.day)) {
                keyDates.push({ date: next.day, desc: '需谨慎', type: 'warning' });
            }
        }
    }

    keyDates.sort((a, b) => a.date - b.date);
    return keyDates.slice(0, 8);
}

/**
 * 生成增强版关键日期
 */
export function generateEnhancedKeyDates(baziOutput: CoreBaziOutput, year: number, month: number): EnhancedKeyDate[] {
    const enhancedKeyDates: EnhancedKeyDate[] = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyData: { day: number; levels: FortuneLevels; chart: FortuneChartScores }[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month - 1, day);
        const f = calculateDailyFortune(baziOutput, d);
        dailyData.push({ day, levels: { overall: f.overall, career: f.career, love: f.love, wealth: f.wealth, health: f.health, social: f.social }, chart: f._chart });
    }

    // 识别局部极值
    for (let i = 1; i < dailyData.length - 1; i++) {
        const prev = dailyData[i - 1], curr = dailyData[i], next = dailyData[i + 1];
        if (curr.chart.overall > prev.chart.overall && curr.chart.overall > next.chart.overall && compareLevels(curr.levels.overall, '吉') >= 0) {
            enhancedKeyDates.push({
                date: curr.day, type: 'peak', levels: curr.levels,
                summary: `运势高峰日（${curr.levels.overall}）`,
                recommendation: '把握这天的好运势，适合推进重要事项，做出关键决策。',
            });
        }
        if (curr.chart.overall < prev.chart.overall && curr.chart.overall < next.chart.overall && compareLevels(curr.levels.overall, '平') < 0) {
            enhancedKeyDates.push({
                date: curr.day, type: 'valley', levels: curr.levels,
                summary: `运势低谷日（${curr.levels.overall}）`,
                recommendation: '今日宜静不宜动，避免重大决策，以休息调整为主。',
            });
        }
    }

    // 大吉日
    for (const d of dailyData) {
        if (d.levels.overall === '大吉' && !enhancedKeyDates.find(k => k.date === d.day)) {
            enhancedKeyDates.push({
                date: d.day, type: 'lucky', levels: d.levels,
                summary: '大吉日！诸事皆宜',
                recommendation: '天时地利人和，诸事皆宜，可大胆行动。',
            });
        }
    }

    // 特殊维度吉日
    for (const d of dailyData) {
        if (enhancedKeyDates.length >= 12) break;
        if (enhancedKeyDates.find(k => k.date === d.day)) continue;
        if (d.levels.wealth === '大吉') {
            enhancedKeyDates.push({ date: d.day, type: 'lucky', levels: d.levels, summary: '财运大吉日', recommendation: '财运亨通，适合投资理财、谈判签约。' });
        } else if (d.levels.career === '大吉') {
            enhancedKeyDates.push({ date: d.day, type: 'lucky', levels: d.levels, summary: '事业吉日', recommendation: '事业运旺，适合面试、汇报、争取晋升。' });
        } else if (d.levels.love === '大吉') {
            enhancedKeyDates.push({ date: d.day, type: 'lucky', levels: d.levels, summary: '桃花日', recommendation: '桃花运旺，适合表白、约会、增进感情。' });
        }
    }

    // 转折点
    for (let i = 2; i < dailyData.length; i++) {
        if (enhancedKeyDates.length >= 14) break;
        const prev2 = dailyData[i - 2], prev1 = dailyData[i - 1], curr = dailyData[i];
        if (!isLevelFavorable(prev2.levels.overall) && !isLevelFavorable(prev1.levels.overall) && isLevelFavorable(curr.levels.overall)) {
            if (!enhancedKeyDates.find(k => k.date === curr.day)) {
                enhancedKeyDates.push({ date: curr.day, type: 'turning', levels: curr.levels, summary: `转运日（${curr.levels.overall}）`, recommendation: '否极泰来，运势开始好转，可逐步恢复行动节奏。' });
            }
        }
        if (isLevelFavorable(prev2.levels.overall) && isLevelFavorable(prev1.levels.overall) && !isLevelFavorable(curr.levels.overall)) {
            if (!enhancedKeyDates.find(k => k.date === curr.day)) {
                enhancedKeyDates.push({ date: curr.day, type: 'warning', levels: curr.levels, summary: `运势骤降日（${curr.levels.overall}）`, recommendation: '运势转弱，宜谨慎行事，避免冲动决策和大额支出。' });
            }
        }
    }

    enhancedKeyDates.sort((a, b) => a.date - b.date);
    return enhancedKeyDates.slice(0, 10);
}

/**
 * 计算周趋势数据（用于趋势图）
 * 返回 FortuneChartScores 供图表渲染
 */
export function calculateWeeklyTrend(baziOutput: CoreBaziOutput, centerDate: Date): { date: string; fullDate: string; dayOfMonth: number; scores: FortuneChartScores }[] {
    const result: { date: string; fullDate: string; dayOfMonth: number; scores: FortuneChartScores }[] = [];
    for (let offset = -2; offset <= 4; offset++) {
        const d = new Date(centerDate);
        d.setDate(d.getDate() + offset);
        const fortune = calculateDailyFortune(baziOutput, d);
        result.push({
            date: `${d.getMonth() + 1}/${d.getDate()}`,
            fullDate: fortune.date,
            dayOfMonth: d.getDate(),
            scores: fortune._chart,
        });
    }
    return result;
}

/**
 * 计算月度趋势数据（用于趋势图）
 */
export function calculateMonthlyTrend(
    baziOutput: CoreBaziOutput,
    year: number,
    month: number
): { date: string; fullDate: string; dayOfMonth: number; scores: FortuneChartScores; isKeyDate?: boolean; keyDateType?: string; keyDateDesc?: string }[] {
    const daysInMonth = new Date(year, month, 0).getDate();
    const result: { date: string; fullDate: string; dayOfMonth: number; scores: FortuneChartScores; isKeyDate?: boolean; keyDateType?: string; keyDateDesc?: string }[] = [];

    const enhancedKeyDates = generateEnhancedKeyDates(baziOutput, year, month);
    const keyDateMap = new Map(enhancedKeyDates.map(k => [k.date, k]));

    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month - 1, day);
        const fortune = calculateDailyFortune(baziOutput, d);
        const keyDate = keyDateMap.get(day);
        result.push({
            date: `${month}/${day}`,
            fullDate: fortune.date,
            dayOfMonth: day,
            scores: fortune._chart,
            isKeyDate: !!keyDate,
            keyDateType: keyDate?.type,
            keyDateDesc: keyDate?.summary,
        });
    }
    return result;
}
