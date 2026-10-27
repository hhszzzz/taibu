import { CHART_TYPES, type ChartType } from '@/lib/visualization/chart-types';
import type { VisualizationSettings } from '@/lib/visualization/settings';
import {
    formatChartStyleLabel,
    formatVisualizationDimensions,
} from '@/lib/visualization/settings';

const CHART_PROMPT_HINTS: Record<ChartType, string> = {
    life_fortune_trend: '适合展示大运/流年趋势，data 需包含 currentAge、currentYear、periods、lifeHighlight。',
    fortune_radar: '适合展示当前多维评分，data 需包含 period、scores、overallScore、overallLabel、topAdvice。',
    wuxing_energy: '适合展示五行能量分布，data 需包含 elements、favorableElement、unfavorableElement、advice、interactions。',
    life_timeline: '适合展示人生关键节点，data 需包含 currentAge、milestones。',
    personality_petal: '适合展示人格特质花瓣图，data 需包含 traits、topTraits、summary。',
    fortune_calendar: '适合展示月度/年度运势日历热力图，data 需包含 year、month、days（每日 overallScore + level）、monthSummary。',
    compatibility_gauge: '适合展示关系兼容度，data 需包含 overallScore、overallLabel、dimensions、highlights、challenges、advice。',
    divination_verdict: '适合展示占卜吉凶判断，data 需包含 verdict、verdictScore、confidence、question、keyFactors、actionAdvice。',
    mbti_spectrum: '适合展示 MBTI 性格分析，data 需包含 type、typeName、dimensions（EI/SN/TF/JP）、traits。',
    tarot_elements: '适合展示塔罗元素能量分布，data 需包含 elements（fire/water/air/earth）、keywords、positions、coreCard。',
    yearly_sparklines: '适合展示年度各维度月度走势，data 需包含 year、dimensions（每个含 key、label、currentScore、monthlyScores）。',
    physiognomy_annotation: '适合展示面相/手相特征标注，data 需包含 type（face/palm）、annotations、overallAssessment。',
    fortune_comparison: '适合展示运势对比柱状图，data 需包含 periodA、periodB、dimensions（含 scoreA/scoreB/change）、summary。',
    cross_system: '适合展示多体系共识分析，data 需包含 systems、consensus、conflicts、overallAdvice。',
    dream_association: '适合展示解梦意象关联网络，data 需包含 nodes、edges、coreInterpretation。',
};

export function buildVisualizationPreferencePrompts(settings?: VisualizationSettings) {
    if (!settings) {
        return {
            dimensionsPrompt: null,
            dayunPrompt: null,
            chartStylePrompt: null,
        };
    }

    return {
        dimensionsPrompt: settings.selectedDimensions?.length
            ? `在进行运势分析时，请重点关注以下维度并提供评分：${formatVisualizationDimensions(settings.selectedDimensions)}。`
            : null,
        dayunPrompt: typeof settings.dayunDisplayCount === 'number'
            ? `涉及大运分析时，仅展开最关键的 ${settings.dayunDisplayCount} 个大运周期，不要默认铺开更多周期。`
            : null,
        chartStylePrompt: settings.chartStyle
            ? `如果需要输出图表说明、可视化建议或结构化呈现，请优先采用${formatChartStyleLabel(settings.chartStyle)}。`
            : null,
    };
}

export function buildVisualizationOutputContractPrompt(allowedChartTypes: ChartType[] = []) {
    const lines: string[] = [];

    if (allowedChartTypes.length > 0) {
        // 有明确数据源 mention → 强制输出对应图表
        lines.push('【重要】请在分析中输出至少一个 ```chart 代码块。');
        lines.push('代码块内部必须是合法 JSON，包含 chartType、title、data 字段。');
        lines.push('请使用以下图表类型：');
        for (const chartType of allowedChartTypes) {
            lines.push(`- ${chartType}: ${CHART_PROMPT_HINTS[chartType] || '请严格遵守对应 chartType 的 JSON 结构。'}`);
        }
    } else {
        // 仅 vizSettings 触发 → 可选输出
        lines.push('当你的分析适合用图表表达时，请输出 ```chart 代码块。');
        lines.push('代码块内部必须是合法 JSON，包含 chartType、title、data 字段。');
    }

    lines.push(`chartType 只能取上面列出的值，不能自造（例如 network、bar）；哪一种都不合适时改用文字说明。${allowedChartTypes.length ? '' : `可用的 chartType：${CHART_TYPES.join('、')}。`}`);
    lines.push('不要输出注释、省略号或无法解析的占位字段。');
    lines.push('优先给出最有价值的 1-2 个图表。');
    return lines.join('\n');
}
