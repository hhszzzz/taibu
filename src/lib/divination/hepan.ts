/**
 * 关系合盘核心库
 *
 * 包含八字合盘算法、五行生克分析、兼容性评估
 */

import { getConflictTriggers } from '@/lib/communication-templates';
import { DI_ZHI, STEM_ELEMENTS, TIAN_GAN, ZHI_WUXING } from 'taibu-core/utils';
import { calculateBazi } from 'taibu-core/bazi';
import { resolveBirthTimeOptions, type BirthTimeResolution } from '@/lib/divination/birth-time';

// 合盘类型
export type HepanType = 'love' | 'business' | 'family';

// 出生信息
export interface BirthInfo extends BirthTimeResolution {
    minute?: number;
    calendarType?: 'solar' | 'lunar';
    isLeapMonth?: boolean;
    longitude?: number;
    name: string;
    year: number;
    month: number;
    day: number;
    /** 省略即出生时辰未知：不排时柱，不拿任何时辰代替 */
    hour?: number;
    gender?: 'male' | 'female';
}

// 五行
export type WuXing = '金' | '木' | '水' | '火' | '土';

// 八字信息
export interface BaZiInfo {
    yearGan: string;
    yearZhi: string;
    monthGan: string;
    monthZhi: string;
    dayGan: string;
    dayZhi: string;
    /** 出生时辰未知时没有时柱 */
    hourGan?: string;
    hourZhi?: string;
    wuxingCount: Record<WuXing, number>;
    dominantWuxing: WuXing;
}

// 兼容性维度
export interface CompatibilityDimension {
    name: string;
    score: number;  // 0-100
    description: string;
}

// 冲突触发因素（从 communication-templates 导入类型）
export interface TriggerFactor {
    scenario: string;    // 触发情境
    trigger: string;     // 触发行为
    warning: string;     // 警示信息
    prevention: string;  // 预防建议
}

// 冲突点（增强版）
export interface ConflictPoint {
    title: string;
    severity: 'low' | 'medium' | 'high';
    description: string;
    suggestion: string;
    triggerFactors?: TriggerFactor[];  // 冲突触发因素
}

// 月度兼容性趋势点
export interface MonthlyCompatibilityTrend {
    month: string;           // 月份标签 (e.g., "1月")
    fullMonth: string;       // 完整日期 (e.g., "2024-01")
    score: number;           // 综合兼容性分数
    dimension: {
        wuxing: number;      // 五行配合
        communication: number; // 沟通契合
        emotion: number;     // 情感共鸣
    };
    event?: string;          // 特殊事件提示
}

// 合盘结果
export interface HepanResult {
    type: HepanType;
    person1: BirthInfo;
    person2: BirthInfo;
    overallScore: number;          // 总体兼容性 0-100
    dimensions: CompatibilityDimension[];
    conflicts: ConflictPoint[];
    createdAt: Date;
}

// 天干五行（直接复用 core utils）
const GAN_WUXING = STEM_ELEMENTS as Record<string, WuXing>;

// 地支五行（直接复用 core utils）
const ZHI_WUXING_MAP = ZHI_WUXING as Record<string, WuXing>;

// 五行相生关系
const WUXING_SHENG: Record<WuXing, WuXing> = {
    '木': '火', '火': '土', '土': '金', '金': '水', '水': '木',
};

// 五行相克关系
const WUXING_KE: Record<WuXing, WuXing> = {
    '木': '土', '土': '水', '水': '火', '火': '金', '金': '木',
};

// 地支六合
const ZHI_LIUHE: Record<string, string> = {
    '子': '丑', '丑': '子',
    '寅': '亥', '亥': '寅',
    '卯': '戌', '戌': '卯',
    '辰': '酉', '酉': '辰',
    '巳': '申', '申': '巳',
    '午': '未', '未': '午',
};

// 地支相冲
const ZHI_CHONG: Record<string, string> = {
    '子': '午', '午': '子',
    '丑': '未', '未': '丑',
    '寅': '申', '申': '寅',
    '卯': '酉', '酉': '卯',
    '辰': '戌', '戌': '辰',
    '巳': '亥', '亥': '巳',
};

/**
 * 简化版月柱计算
 */
function getMonthPillar(year: number, month: number): { gan: string; zhi: string } {
    const zhiIndex = (month + 1) % 12;
    const yearGanIndex = (year - 4) % 10;
    const monthGanStart = (yearGanIndex % 5) * 2;
    const ganIndex = (monthGanStart + month - 1) % 10;
    return {
        gan: TIAN_GAN[ganIndex],
        zhi: DI_ZHI[zhiIndex],
    };
}

/**
 * 计算八字
 */
export function calculateBaZi(birth: BirthInfo): BaZiInfo {
    const { fourPillars } = calculateBazi({
        gender: birth.gender ?? 'male',
        birthYear: birth.year,
        birthMonth: birth.month,
        birthDay: birth.day,
        ...(birth.hour === undefined ? {} : { birthHour: birth.hour, birthMinute: birth.minute ?? 0 }),
        calendarType: birth.calendarType ?? 'solar',
        isLeapMonth: birth.isLeapMonth,
        longitude: birth.longitude,
        ...resolveBirthTimeOptions(birth),
    });
    const yearPillar = { gan: fourPillars.year.stem, zhi: fourPillars.year.branch };
    const monthPillar = { gan: fourPillars.month.stem, zhi: fourPillars.month.branch };
    const dayPillar = { gan: fourPillars.day.stem, zhi: fourPillars.day.branch };
    const hourPillar = fourPillars.hour && { gan: fourPillars.hour.stem, zhi: fourPillars.hour.branch };

    // 统计五行（时辰未知时只数年、月、日三柱）
    const wuxingCount: Record<WuXing, number> = { '金': 0, '木': 0, '水': 0, '火': 0, '土': 0 };
    const allGanZhi = [
        yearPillar.gan, yearPillar.zhi,
        monthPillar.gan, monthPillar.zhi,
        dayPillar.gan, dayPillar.zhi,
        ...(hourPillar ? [hourPillar.gan, hourPillar.zhi] : []),
    ];

    for (const gz of allGanZhi) {
        const wuxing = GAN_WUXING[gz] || ZHI_WUXING_MAP[gz];
        if (wuxing) wuxingCount[wuxing]++;
    }

    // 找出最多的五行
    let dominantWuxing: WuXing = '土';
    let maxCount = 0;
    for (const [wx, count] of Object.entries(wuxingCount)) {
        if (count > maxCount) {
            maxCount = count;
            dominantWuxing = wx as WuXing;
        }
    }

    return {
        yearGan: yearPillar.gan,
        yearZhi: yearPillar.zhi,
        monthGan: monthPillar.gan,
        monthZhi: monthPillar.zhi,
        dayGan: dayPillar.gan,
        dayZhi: dayPillar.zhi,
        ...(hourPillar ? { hourGan: hourPillar.gan, hourZhi: hourPillar.zhi } : {}),
        wuxingCount,
        dominantWuxing,
    };
}

/**
 * 计算五行相生相克关系
 */
function calculateWuxingRelation(wx1: WuXing, wx2: WuXing): 'sheng' | 'ke' | 'bei_ke' | 'bei_sheng' | 'neutral' {
    if (WUXING_SHENG[wx1] === wx2) return 'sheng';      // wx1 生 wx2
    if (WUXING_SHENG[wx2] === wx1) return 'bei_sheng';  // wx1 被 wx2 生
    if (WUXING_KE[wx1] === wx2) return 'ke';            // wx1 克 wx2
    if (WUXING_KE[wx2] === wx1) return 'bei_ke';        // wx1 被 wx2 克
    return 'neutral';
}

/**
 * 分析合盘兼容性
 */
export function analyzeCompatibility(
    person1: BirthInfo,
    person2: BirthInfo,
    type: HepanType
): HepanResult {
    const bazi1 = calculateBaZi(person1);
    const bazi2 = calculateBaZi(person2);

    const dimensions: CompatibilityDimension[] = [];
    const conflicts: ConflictPoint[] = [];

    // 1. 五行配合度
    const wuxingRelation = calculateWuxingRelation(bazi1.dominantWuxing, bazi2.dominantWuxing);
    let wuxingScore = 60;
    let wuxingDesc = '';

    switch (wuxingRelation) {
        case 'sheng':
            wuxingScore = 85;
            wuxingDesc = `${person1.name}(${bazi1.dominantWuxing})生${person2.name}(${bazi2.dominantWuxing})，付出型关系`;
            break;
        case 'bei_sheng':
            wuxingScore = 80;
            wuxingDesc = `${person1.name}被${person2.name}滋养，接受型关系`;
            break;
        case 'ke':
            wuxingScore = 50;
            wuxingDesc = `${person1.name}(${bazi1.dominantWuxing})克${person2.name}(${bazi2.dominantWuxing})，需注意相处方式`;
            conflicts.push({
                title: '五行相克',
                severity: 'medium',
                description: `${bazi1.dominantWuxing}克${bazi2.dominantWuxing}，可能存在无意识的压制`,
                suggestion: '多包容理解，避免强势态度',
                triggerFactors: getConflictTriggers('五行相克'),
            });
            break;
        case 'bei_ke':
            wuxingScore = 45;
            wuxingDesc = `${person1.name}被${person2.name}压制，需要空间`;
            conflicts.push({
                title: '五行被克',
                severity: 'medium',
                description: `${bazi2.dominantWuxing}克${bazi1.dominantWuxing}，${person1.name}可能感到压力`,
                suggestion: '给予对方足够的个人空间',
                triggerFactors: getConflictTriggers('五行被克'),
            });
            break;
        default:
            wuxingScore = 70;
            wuxingDesc = '五行平和，关系均衡';
    }

    dimensions.push({
        name: '五行配合',
        score: wuxingScore,
        description: wuxingDesc,
    });

    // 2. 日柱相合/相冲
    const dayZhi1 = bazi1.dayZhi;
    const dayZhi2 = bazi2.dayZhi;
    let dayScore = 60;
    let dayDesc = '';

    if (ZHI_LIUHE[dayZhi1] === dayZhi2) {
        dayScore = 90;
        dayDesc = '日支六合，天作之合';
    } else if (ZHI_CHONG[dayZhi1] === dayZhi2) {
        dayScore = 40;
        dayDesc = '日支相冲，易生摩擦';
        conflicts.push({
            title: '日支相冲',
            severity: 'high',
            description: `${dayZhi1}与${dayZhi2}相冲，日常相处可能产生摩擦`,
            suggestion: '增加沟通，学会换位思考',
            triggerFactors: getConflictTriggers('日支相冲'),
        });
    } else {
        dayScore = 65;
        dayDesc = '日支平和';
    }

    dimensions.push({
        name: '日柱缘分',
        score: dayScore,
        description: dayDesc,
    });

    // 3. 年柱契合度
    const yearZhi1 = bazi1.yearZhi;
    const yearZhi2 = bazi2.yearZhi;
    let yearScore = 60;
    let yearDesc = '';

    if (ZHI_LIUHE[yearZhi1] === yearZhi2) {
        yearScore = 85;
        yearDesc = '年支六合，家庭背景契合';
    } else if (ZHI_CHONG[yearZhi1] === yearZhi2) {
        yearScore = 50;
        yearDesc = '年支相冲，家庭观念有差异';
    } else {
        yearScore = 65;
        yearDesc = '年柱平和';
    }

    dimensions.push({
        name: '家庭契合',
        score: yearScore,
        description: yearDesc,
    });

    // 4. 根据类型添加特定维度（基于柱位五行生克的确定性计算）
    if (type === 'love') {
        // 感情缘分：基于月柱关系（月支六合/相冲 + 月干五行生克）
        const monthZhi1 = bazi1.monthZhi;
        const monthZhi2 = bazi2.monthZhi;
        const monthGanRelation = calculateWuxingRelation(
            GAN_WUXING[bazi1.monthGan],
            GAN_WUXING[bazi2.monthGan]
        );

        let emotionScore = 60;
        let emotionDesc = '';

        if (ZHI_LIUHE[monthZhi1] === monthZhi2) {
            emotionScore += 25;
            emotionDesc = '月支六合，情感共鸣深厚';
        } else if (ZHI_CHONG[monthZhi1] === monthZhi2) {
            emotionScore -= 15;
            emotionDesc = '月支相冲，情感表达方式有差异';
        }

        if (monthGanRelation === 'sheng' || monthGanRelation === 'bei_sheng') {
            emotionScore += 10;
            if (!emotionDesc) emotionDesc = '月干相生，感情基础深厚';
        } else if (monthGanRelation === 'ke' || monthGanRelation === 'bei_ke') {
            emotionScore -= 5;
            if (!emotionDesc) emotionDesc = '月干相克，感情需要经营';
        } else {
            if (!emotionDesc) emotionDesc = '感情平稳，需用心经营';
        }

        dimensions.push({
            name: '感情缘分',
            score: Math.max(30, Math.min(95, emotionScore)),
            description: emotionDesc,
        });
    } else if (type === 'business' && bazi1.hourGan && bazi1.hourZhi && bazi2.hourGan && bazi2.hourZhi) {
        // 事业互补：基于时柱关系（时支六合/相冲 + 时干五行生克）；有一方出生时辰未知就没有时柱可比，不给这一项
        const hourZhi1 = bazi1.hourZhi;
        const hourZhi2 = bazi2.hourZhi;
        const hourGanRelation = calculateWuxingRelation(
            GAN_WUXING[bazi1.hourGan],
            GAN_WUXING[bazi2.hourGan]
        );

        let businessScore = 60;
        let businessDesc = '';

        if (ZHI_LIUHE[hourZhi1] === hourZhi2) {
            businessScore += 25;
            businessDesc = '时支六合，事业目标一致';
        } else if (ZHI_CHONG[hourZhi1] === hourZhi2) {
            businessScore -= 15;
            businessDesc = '时支相冲，事业理念有分歧';
        }

        if (hourGanRelation === 'sheng' || hourGanRelation === 'bei_sheng') {
            businessScore += 10;
            if (!businessDesc) businessDesc = '时干相生，能力互补，协作顺畅';
        } else if (hourGanRelation === 'ke' || hourGanRelation === 'bei_ke') {
            businessScore -= 5;
            if (!businessDesc) businessDesc = '时干相克，需明确分工';
        } else {
            if (!businessDesc) businessDesc = '事业配合平稳，需磨合协作方式';
        }

        dimensions.push({
            name: '事业互补',
            score: Math.max(30, Math.min(95, businessScore)),
            description: businessDesc,
        });
    } else if (type === 'family') {
        // 亲子沟通：基于双方月柱交叉关系（月支六合/相冲 + 月干五行生克）
        const monthGanRelation = calculateWuxingRelation(
            GAN_WUXING[bazi1.monthGan],
            GAN_WUXING[bazi2.monthGan]
        );
        const monthZhi1 = bazi1.monthZhi;
        const monthZhi2 = bazi2.monthZhi;

        let familyScore = 60;
        let familyDesc = '';

        if (ZHI_LIUHE[monthZhi1] === monthZhi2) {
            familyScore += 25;
            familyDesc = '月支六合，沟通顺畅，理解深';
        } else if (ZHI_CHONG[monthZhi1] === monthZhi2) {
            familyScore -= 15;
            familyDesc = '月支相冲，沟通方式需调整';
        }

        if (monthGanRelation === 'sheng' || monthGanRelation === 'bei_sheng') {
            familyScore += 10;
            if (!familyDesc) familyDesc = '月干相生，亲子关系融洽';
        } else if (monthGanRelation === 'ke' || monthGanRelation === 'bei_ke') {
            familyScore -= 5;
            if (!familyDesc) familyDesc = '月干相克，需增加交流';
        } else {
            if (!familyDesc) familyDesc = '亲子关系平稳，需多互动增进理解';
        }

        dimensions.push({
            name: '亲子沟通',
            score: Math.max(30, Math.min(95, familyScore)),
            description: familyDesc,
        });
    }

    // 计算总分
    const overallScore = Math.round(
        dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length
    );

    return {
        type,
        person1,
        person2,
        overallScore,
        dimensions,
        conflicts,
        createdAt: new Date(),
    };
}

/**
 * 获取合盘类型名称
 */
export function getHepanTypeName(type: HepanType): string {
    const names: Record<HepanType, string> = {
        love: '情侣合婚',
        business: '商业合伙',
        family: '亲子关系',
    };
    return names[type];
}

/**
 * 获取兼容性等级
 */
export function getCompatibilityLevel(score: number): { level: string; color: string } {
    if (score >= 80) return { level: '极佳', color: 'text-green-500' };
    if (score >= 65) return { level: '良好', color: 'text-blue-500' };
    if (score >= 50) return { level: '一般', color: 'text-yellow-500' };
    return { level: '需注意', color: 'text-red-500' };
}

/**
 * 计算兼容性走势
 *
 * 基于双方八字与流月的关系，预测未来6/12个月的兼容性变化
 */
export function calculateCompatibilityTrend(
    person1: BirthInfo,
    person2: BirthInfo,
    months: 6 | 12
): MonthlyCompatibilityTrend[] {
    const bazi1 = calculateBaZi(person1);
    const bazi2 = calculateBaZi(person2);
    const result: MonthlyCompatibilityTrend[] = [];

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    for (let i = 0; i < months; i++) {
        let targetMonth = currentMonth + i;
        let targetYear = currentYear;

        if (targetMonth > 12) {
            targetMonth -= 12;
            targetYear++;
        }

        // 获取该月的月柱
        const monthPillar = getMonthPillar(targetYear, targetMonth);
        const monthElement = GAN_WUXING[monthPillar.gan];

        // 计算流月与双方八字的关系
        const relation1 = calculateWuxingRelation(bazi1.dominantWuxing, monthElement);
        const relation2 = calculateWuxingRelation(bazi2.dominantWuxing, monthElement);

        // 基础分计算
        let baseScore = 65;
        const relationScores: Record<string, number> = {
            'sheng': 8,      // 生月，能量输出
            'bei_sheng': 12, // 被月生，得到滋养
            'ke': -5,        // 克月，消耗
            'bei_ke': -10,   // 被月克，压力
            'neutral': 0,
        };

        baseScore += (relationScores[relation1] || 0) + (relationScores[relation2] || 0);

        // 检查流月地支与日支的关系
        const monthZhi = monthPillar.zhi;
        let event: string | undefined;

        // 检查六合
        if (ZHI_LIUHE[bazi1.dayZhi] === monthZhi || ZHI_LIUHE[bazi2.dayZhi] === monthZhi) {
            baseScore += 8;
            event = '贵人月，关系和谐';
        }

        // 检查相冲
        if (ZHI_CHONG[bazi1.dayZhi] === monthZhi) {
            baseScore -= 6;
            event = `${person1.name}冲月，需多关照`;
        }
        if (ZHI_CHONG[bazi2.dayZhi] === monthZhi) {
            baseScore -= 6;
            event = event
                ? '双方均遇冲月，需多沟通'
                : `${person2.name}冲月，需多关照`;
        }

        // 确保分数在合理范围
        const score = Math.max(35, Math.min(95, Math.round(baseScore)));

        // 计算各维度分数（基于不同柱位的确定性关系）
        // 五行配合：流月天干五行与双方主五行的关系（已体现在 baseScore 中）
        const wuxingDimBase = 65 + (relationScores[relation1] || 0) + (relationScores[relation2] || 0);

        // 沟通契合：流月地支与双方月支的六合/相冲关系
        let commOffset = 0;
        if (ZHI_LIUHE[bazi1.monthZhi] === monthZhi) commOffset += 10;
        else if (ZHI_CHONG[bazi1.monthZhi] === monthZhi) commOffset -= 8;
        if (ZHI_LIUHE[bazi2.monthZhi] === monthZhi) commOffset += 10;
        else if (ZHI_CHONG[bazi2.monthZhi] === monthZhi) commOffset -= 8;
        const communicationDimBase = 65 + commOffset;

        // 情感共鸣：流月天干五行与双方日干（日主）五行的关系
        const dayElement1 = GAN_WUXING[bazi1.dayGan];
        const dayElement2 = GAN_WUXING[bazi2.dayGan];
        const dayRelation1 = calculateWuxingRelation(dayElement1, monthElement);
        const dayRelation2 = calculateWuxingRelation(dayElement2, monthElement);
        const emotionDimBase = 65 + (relationScores[dayRelation1] || 0) + (relationScores[dayRelation2] || 0);

        const wuxingScore = Math.max(40, Math.min(95, Math.round(wuxingDimBase)));
        const communicationScore = Math.max(40, Math.min(95, Math.round(communicationDimBase)));
        const emotionScore = Math.max(40, Math.min(95, Math.round(emotionDimBase)));

        result.push({
            month: `${targetMonth}月`,
            fullMonth: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
            score,
            dimension: {
                wuxing: wuxingScore,
                communication: communicationScore,
                emotion: emotionScore,
            },
            event,
        });
    }

    return result;
}

/**
 * 获取关系发展建议
 */
export function getRelationshipAdvice(
    trend: MonthlyCompatibilityTrend[],
    type: HepanType
): string[] {
    const advice: string[] = [];

    // 分析趋势
    const firstHalf = trend.slice(0, Math.floor(trend.length / 2));
    const secondHalf = trend.slice(Math.floor(trend.length / 2));
    const firstAvg = firstHalf.reduce((sum, t) => sum + t.score, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, t) => sum + t.score, 0) / secondHalf.length;

    if (secondAvg > firstAvg + 5) {
        advice.push('整体运势呈上升趋势，后期发展更为顺利');
    } else if (secondAvg < firstAvg - 5) {
        advice.push('后期运势有所回落，建议提前储备感情基础');
    }

    // 找出高峰期
    const peakMonths = trend.filter(t => t.score >= 75);
    if (peakMonths.length > 0) {
        const peakNames = peakMonths.slice(0, 3).map(p => p.month).join('、');
        advice.push(`${peakNames}为关系高峰期，适合共同规划重要事项`);
    }

    // 找出低谷期
    const valleyMonths = trend.filter(t => t.score < 55);
    if (valleyMonths.length > 0) {
        const valleyNames = valleyMonths.slice(0, 2).map(v => v.month).join('、');
        advice.push(`${valleyNames}需要更多耐心和理解，避免重大决策`);
    }

    // 根据类型添加特定建议
    const typeAdvice: Record<HepanType, string> = {
        love: '保持日常小惊喜，定期安排约会时间',
        business: '重要决策选择高分月份，低谷期专注内部优化',
        family: '高峰期多互动交流，低谷期给予空间',
    };
    advice.push(typeAdvice[type]);

    return advice;
}
