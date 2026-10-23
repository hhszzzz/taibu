/**
 * 四柱智能计算工具
 * 根据已选择的柱逐步计算下一柱的可能选项
 */

import type { HeavenlyStem, EarthlyBranch } from '@/types';

// 天干和地支数组
const STEMS: HeavenlyStem[] = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES: EarthlyBranch[] = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

interface PillarData {
    stem: HeavenlyStem;
    branch: EarthlyBranch;
}

/**
 * 六十甲子配对规则
 * 天干和地支的组合必须满足：(天干索引 - 地支索引) % 2 === 0
 * 即：阳干配阳支，阴干配阴支
 */
export function isValidPillar(stem: HeavenlyStem, branch: EarthlyBranch): boolean {
    const stemIndex = STEMS.indexOf(stem);
    const branchIndex = BRANCHES.indexOf(branch);

    if (stemIndex === -1 || branchIndex === -1) return false;

    // 阳干（甲丙戊庚壬）配阳支（子寅辰午申戌）
    // 阴干（乙丁己辛癸）配阴支（丑卯巳未酉亥）
    return (stemIndex % 2) === (branchIndex % 2);
}

/**
 * 根据天干计算可选的地支（符合六十甲子规则）
 */
export function getAvailableBranches(stem: HeavenlyStem): EarthlyBranch[] {
    return BRANCHES.filter(branch => isValidPillar(stem, branch));
}

/**
 * 根据年柱计算可能的月柱
 * 月柱的天干由年干推算：
 * 甲己之年丙作首，乙庚之年戊为头
 * 丙辛之年庚寅上，丁壬壬寅顺行流
 * 戊癸之年甲寅始
 */
export function calculateMonthPillars(yearPillar: PillarData): PillarData[] {
    const yearStem = yearPillar.stem;

    // 根据年干确定正月（寅月）的天干
    const firstMonthStemMap: Record<HeavenlyStem, HeavenlyStem> = {
        '甲': '丙', '己': '丙',
        '乙': '戊', '庚': '戊',
        '丙': '庚', '辛': '庚',
        '丁': '壬', '壬': '壬',
        '戊': '甲', '癸': '甲',
    };

    const firstMonthStem = firstMonthStemMap[yearStem];
    const firstMonthStemIndex = STEMS.indexOf(firstMonthStem);

    const monthPillars: PillarData[] = [];

    // 12个月，从寅月开始（地支索引2）
    for (let i = 0; i < 12; i++) {
        const monthBranchIndex = (2 + i) % 12; // 从寅月开始
        const monthStemIndex = (firstMonthStemIndex + i) % 10;

        monthPillars.push({
            stem: STEMS[monthStemIndex],
            branch: BRANCHES[monthBranchIndex],
        });
    }

    return monthPillars;
}

/**
 * 根据日柱计算可能的时柱
 * 时柱的天干由日干推算：
 * 甲己日起甲子时，乙庚日起丙子时
 * 丙辛日起戊子时，丁壬日起庚子时
 * 戊癸日起壬子时
 */
export function calculateHourPillars(dayPillar: PillarData): PillarData[] {
    const dayStem = dayPillar.stem;

    // 根据日干确定子时的天干
    const firstHourStemMap: Record<HeavenlyStem, HeavenlyStem> = {
        '甲': '甲', '己': '甲',
        '乙': '丙', '庚': '丙',
        '丙': '戊', '辛': '戊',
        '丁': '庚', '壬': '庚',
        '戊': '壬', '癸': '壬',
    };

    const firstHourStem = firstHourStemMap[dayStem];
    const firstHourStemIndex = STEMS.indexOf(firstHourStem);

    const hourPillars: PillarData[] = [];

    // 12个时辰，从子时开始（地支索引0）
    for (let i = 0; i < 12; i++) {
        const hourBranchIndex = i;
        const hourStemIndex = (firstHourStemIndex + i) % 10;

        hourPillars.push({
            stem: STEMS[hourStemIndex],
            branch: BRANCHES[hourBranchIndex],
        });
    }

    return hourPillars;
}
