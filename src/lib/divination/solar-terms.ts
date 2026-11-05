/**
 * 节气系统
 * 
 * 提供二十四节气计算和信息
 */

import { Solar } from 'lunar-javascript';

// ===== 节气定义 =====

export interface SolarTerm {
    name: string;
    date: string;  // YYYY-MM-DD
    meaning: string;
    tips: string;
}

/** 二十四节气名称 */
export const SOLAR_TERM_NAMES = [
    '小寒', '大寒', '立春', '雨水', '惊蛰', '春分',
    '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
    '小暑', '大暑', '立秋', '处暑', '白露', '秋分',
    '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'
];

/** 节气含义与建议 */
export const SOLAR_TERM_INFO: Record<string, { meaning: string; tips: string }> = {
    '小寒': { meaning: '天气渐寒，尚未大冷', tips: '注意保暖，适当进补' },
    '大寒': { meaning: '一年中最冷的时期', tips: '防寒保暖，早睡晚起' },
    '立春': { meaning: '春季开始，万物复苏', tips: '调整作息，舒展身心' },
    '雨水': { meaning: '降雨开始，雨量渐增', tips: '注意防潮，养肝护脾' },
    '惊蛰': { meaning: '春雷始鸣，蛰虫惊醒', tips: '预防感冒，饮食清淡' },
    '春分': { meaning: '昼夜平分，阴阳相半', tips: '调和阴阳，保持平衡' },
    '清明': { meaning: '天清气明，万物生长', tips: '踏青郊游，缅怀先人' },
    '谷雨': { meaning: '雨生百谷，播种时节', tips: '祛湿健脾，适度运动' },
    '立夏': { meaning: '夏季开始，气温升高', tips: '养心安神，午休养阳' },
    '小满': { meaning: '夏熟作物籽粒渐满', tips: '清热利湿，饮食清淡' },
    '芒种': { meaning: '有芒作物成熟收割', tips: '防暑降温，补充水分' },
    '夏至': { meaning: '白昼最长，阳气最盛', tips: '养阴清热，避免暴晒' },
    '小暑': { meaning: '天气炎热，尚未极热', tips: '消暑降温，静心养神' },
    '大暑': { meaning: '一年中最热的时期', tips: '防暑避湿，清淡饮食' },
    '立秋': { meaning: '秋季开始，暑去凉来', tips: '养阴润燥，调整作息' },
    '处暑': { meaning: '暑气渐消，秋意渐浓', tips: '早睡早起，滋阴润肺' },
    '白露': { meaning: '天气转凉，露水凝白', tips: '防寒保暖，润肺防燥' },
    '秋分': { meaning: '昼夜再次平分', tips: '阴阳平衡，养生进补' },
    '寒露': { meaning: '露水寒冷，将要结霜', tips: '保暖防寒，滋阴润燥' },
    '霜降': { meaning: '天气渐冷，开始有霜', tips: '防寒保暖，健脾养胃' },
    '立冬': { meaning: '冬季开始，万物收藏', tips: '早睡晚起，进补养藏' },
    '小雪': { meaning: '开始降雪，雪量尚小', tips: '保暖防寒，养肾防寒' },
    '大雪': { meaning: '降雪增多，天气更冷', tips: '注意保暖，适当进补' },
    '冬至': { meaning: '白昼最短，阴极阳生', tips: '养生进补，早睡晚起' },
};

// ===== 节气计算（使用 lunar-javascript） =====

/**
 * 获取某年的所有节气
 */
export function getYearSolarTerms(year: number): SolarTerm[] {
    const terms: SolarTerm[] = [];

    // One lookup returns the whole year's 24 terms (plus adjacent years'), so the month loop was redundant.
    const jieQi = Solar.fromYmd(year, 7, 1).getLunar().getJieQiTable();
    for (const [name, jq] of Object.entries(jieQi)) {
        if (!SOLAR_TERM_NAMES.includes(name)) {
            continue;
        }
        const jqSolar = jq as unknown as { getYear: () => number; getMonth: () => number; getDay: () => number };
        const jqYear = jqSolar.getYear();
        if (jqYear !== year) {
            continue;
        }
        const jqMonth = jqSolar.getMonth();
        const jqDay = jqSolar.getDay();
        const dateStr = `${jqYear}-${String(jqMonth).padStart(2, '0')}-${String(jqDay).padStart(2, '0')}`;
        const info = SOLAR_TERM_INFO[name] || { meaning: '', tips: '' };
        terms.push({
            name,
            date: dateStr,
            meaning: info.meaning,
            tips: info.tips,
        });
    }

    // 去重并排序
    const unique = Array.from(new Map(terms.map(t => [t.date, t])).values());
    return unique.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 获取下一个节气
 */
export function getNextSolarTerm(): SolarTerm | null {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const year = now.getFullYear();

    // 获取今年和明年的节气
    const terms = [...getYearSolarTerms(year), ...getYearSolarTerms(year + 1)];

    return terms.find(t => t.date > today) || null;
}

/**
 * 获取节气含义
 */
export function getSolarTermMeaning(termName: string): { meaning: string; tips: string } {
    return SOLAR_TERM_INFO[termName] || { meaning: '未知节气', tips: '' };
}
