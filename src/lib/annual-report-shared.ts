export type AnnualReportFeatureUsage = {
    bazi: number;
    ziwei: number;
    liuyao: number;
    tarot: number;
    palm: number;
    face: number;
    mbti: number;
    hepan: number;
    fortune: number;
    qimen: number;
    daliuren: number;
    meihua: number;
    xiaoliuren: number;
    chat: number;
};

export interface AnnualReportData {
    year: number;
    userId: string;
    generatedAt: string;
    usage: {
        totalAnalyses: number;
        totalChats: number;
        activeMonths: number;
        firstUseDate: string | null;
        lastUseDate: string | null;
    };
    featureUsage: AnnualReportFeatureUsage;
    activity: {
        monthlyUsage: { month: number; count: number }[];
        weekdayDistribution: { day: number; count: number }[];
        peakHour: number;
    };
    insights?: string[];
}

export const ANNUAL_REPORT_FEATURE_NAMES: Record<keyof AnnualReportFeatureUsage, string> = {
    bazi: '八字命理',
    ziwei: '紫微斗数',
    liuyao: '六爻占卜',
    tarot: '塔罗占卜',
    palm: '手相分析',
    face: '面相分析',
    mbti: 'MBTI',
    hepan: '合盘分析',
    fortune: '运势分析',
    qimen: '奇门遁甲',
    daliuren: '大六壬',
    meihua: '梅花易数',
    xiaoliuren: '小六壬',
    chat: 'AI 对话',
};
