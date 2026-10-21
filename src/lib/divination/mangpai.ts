/**
 * 盲派命理数据处理模块
 * 
 * 根据日柱天干地支从 mangpai.json 获取对应的口诀和称号
 */

import * as fs from 'fs';
import * as path from 'path';

export interface MangpaiEntry {
    index: number;
    type: string;      // 如 "甲子日"
    称号: string;       // 如 "天德贵人"
    口诀: string;       // 如 "甲子开元侬先来，水生木旺有文才..."
}

// 懒加载盲派数据
let mangpaiCache: MangpaiEntry[] | null = null;

function loadMangpaiData(): MangpaiEntry[] {
    if (mangpaiCache) return mangpaiCache;

    const filePath = path.join(process.cwd(), 'public', 'mangpai', 'mangpai.json');
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    mangpaiCache = JSON.parse(fileContent) as MangpaiEntry[];
    return mangpaiCache;
}

/**
 * 根据日柱获取盲派口诀
 * @param dayPillar 日柱天干地支，如 "甲子"
 * @returns 匹配的盲派条目，未找到返回 null
 */
export function getMangpaiByDayPillar(dayPillar: string): MangpaiEntry | null {
    // 尝试匹配 "甲子日" 格式
    const dayType = dayPillar.endsWith('日') ? dayPillar : `${dayPillar}日`;

    const mangpaiList = loadMangpaiData();
    const entry = mangpaiList.find(item => item.type === dayType);
    return entry || null;
}

/**
 * 从八字数据中提取日柱
 * @param chartData 八字命盘数据
 * @returns 日柱天干地支，如 "甲子"
 */
export function extractDayPillar(chartData: { fourPillars?: { day?: { stem?: string; branch?: string } } }): string | null {
    const day = chartData?.fourPillars?.day;
    if (day?.stem && day?.branch) {
        return `${day.stem}${day.branch}`;
    }
    return null;
}
