import { CHART_TYPES, type ChartType } from '@/lib/visualization/chart-types';
import type { VisualizationSettings } from '@/lib/visualization/settings';
import {
    formatChartStyleLabel,
    formatVisualizationDimensions,
} from '@/lib/visualization/settings';
import { VISUALIZATION_OUTPUT_ENABLED } from '@/lib/visualization/output-switch';

interface ChartPromptHint {
    label: string;
    when: string;
    /** data 的紧凑 JSON 骨架：模型按这个结构填，字段名不得改写。 */
    schema: string;
}

/** 图表输出总开关在 output-switch.ts 中维护，客户端设置面板只引用它，不打包整份提示词。 */

/**
 * 一种可视化体系：内置图表模板（```chart，模型只写 JSON）与沙箱 HTML（```visual）。
 * 这里的提示同时供普通对话、各占术解读和 Agent 使用，类型说明只维护这一份。
 */
export const CHART_PROMPT_HINTS: Record<ChartType, ChartPromptHint> = {
    life_fortune_trend: {
        label: '大运趋势',
        when: '展示大运/流年走势。',
        schema: '{"currentAge":24,"currentYear":2026,"periods":[{"label":"辛亥","startAge":23,"endAge":32,"startYear":2025,"endYear":2034,"scores":{"career":65,"wealth":58,"love":60,"health":55,"family":60,"windfall":40},"summary":"一句话","highlights":["…"],"warnings":["…"],"yearlyScores":[{"year":2026,"age":24,"overall":62}]}],"lifeHighlight":{"bestPeriod":{"label":"庚戌","ages":"33-42","reason":"…"},"currentStatus":"…","nextTurningPoint":{"age":33,"direction":"up","reason":"…"}}}',
    },
    fortune_radar: {
        label: '运势雷达',
        when: '展示当前多维评分。',
        schema: '{"period":"2026年","scores":{"career":{"score":72,"label":"事业/学业","trend":"up"}},"previousScores":{"career":66},"overallScore":72,"overallLabel":"…","topAdvice":"…"}',
    },
    fortune_calendar: {
        label: '运势日历',
        when: '展示月度/年度运势热力图。',
        schema: '{"year":2026,"month":11,"days":[{"date":1,"overallScore":70,"level":"吉","highlight":"…"}],"monthSummary":{"bestDays":[3],"cautionDays":[8],"luckyDayCount":10,"normalDayCount":18,"cautionDayCount":3}}',
    },
    wuxing_energy: {
        label: '五行能量',
        when: '展示五行能量分布。',
        schema: '{"elements":{"wood":{"strength":40,"level":"旺","stars":[]},"fire":{"strength":14,"level":"平","stars":[]},"earth":{"strength":20,"level":"平","stars":[]},"metal":{"strength":10,"level":"弱","stars":[]},"water":{"strength":16,"level":"平","stars":[]}},"favorableElement":"fire","unfavorableElement":"wood","advice":"…","interactions":[{"from":"wood","to":"earth","type":"克","impact":"…"}]}',
    },
    life_timeline: {
        label: '人生时间轴',
        when: '展示人生关键节点。',
        schema: '{"currentAge":24,"milestones":[{"age":18,"year":2020,"label":"…","type":"turning","icon":"…","summary":"…","detail":"…"}]}',
    },
    compatibility_gauge: {
        label: '合婚仪表',
        when: '展示关系兼容度。',
        schema: '{"overallScore":74,"overallLabel":"…","dimensions":[{"key":"career","label":"事业","score":80,"detail":"…"}],"highlights":["…"],"challenges":["…"],"advice":"…"}',
    },
    divination_verdict: {
        label: '占卜结论',
        when: '展示占卜吉凶判断。',
        schema: '{"verdict":"…","verdictScore":72,"confidence":"medium","question":"…","keyFactors":[{"factor":"…","impact":"positive","detail":"…"}],"timeline":[{"time":"…","event":"…","advice":"…"}],"actionAdvice":"…"}',
    },
    mbti_spectrum: {
        label: 'MBTI 光谱',
        when: '展示 MBTI 性格分析。',
        schema: '{"type":"INTJ","typeName":"…","dimensions":{"EI":{"score":30,"direction":"I","label":"内向"},"SN":{"score":60,"direction":"N","label":"直觉"},"TF":{"score":70,"direction":"T","label":"思考"},"JP":{"score":40,"direction":"J","label":"判断"}},"traits":[{"trait":"…","description":"…"}],"cognitiveStack":["Ni","Te","Fi","Se"]}',
    },
    tarot_elements: {
        label: '塔罗元素',
        when: '展示塔罗元素能量分布。',
        schema: '{"elements":{"fire":{"count":2,"percentage":40,"label":"火"},"water":{"count":1,"percentage":20,"label":"水"},"air":{"count":1,"percentage":20,"label":"风"},"earth":{"count":1,"percentage":20,"label":"土"}},"keywords":["…"],"positions":[{"position":"过去","card":"愚者","upright":true,"energy":70}],"coreCard":{"name":"…","meaning":"…"}}',
    },
    personality_petal: {
        label: '人格花瓣',
        when: '展示人格特质。',
        schema: '{"traits":[{"key":"openness","label":"开放性","score":80,"description":"…"}],"topTraits":["…"],"summary":"…"}',
    },
    yearly_sparklines: {
        label: '年度走势',
        when: '展示年度各维度月度走势。',
        schema: '{"year":2026,"dimensions":[{"key":"career","label":"事业/学业","currentScore":72,"trend":"up","monthlyScores":[60,62,65,68,70,72,70,68,66,70,73,75]}]}',
    },
    physiognomy_annotation: {
        label: '面相标注',
        when: '展示面相/手相特征标注。',
        schema: '{"type":"face","annotations":[{"region":"…","label":"…","rating":"positive","position":{"x":50,"y":40},"detail":"…"}],"overallAssessment":"…"}',
    },
    fortune_comparison: {
        label: '运势对比',
        when: '展示两个时段的对比柱状图。',
        schema: '{"periodA":{"label":"2026年","year":2026},"periodB":{"label":"2027年","year":2027},"dimensions":[{"key":"career","label":"事业/学业","scoreA":65,"scoreB":72,"change":"上升"}],"summary":"…"}',
    },
    cross_system: {
        label: '多体系共识',
        when: '展示多体系共识分析。',
        schema: '{"systems":[{"name":"八字","scores":{"career":70,"wealth":60}}],"consensus":[{"dimension":"career","label":"事业/学业","agreement":80,"detail":"…"}],"overallAgreement":75,"advice":"…"}',
    },
    dream_association: {
        label: '解梦关联',
        when: '展示解梦意象关联网络。',
        schema: '{"nodes":[{"id":"water","label":"水","meaning":"…","sentiment":"neutral","size":"medium"}],"edges":[{"from":"water","to":"fear","strength":60,"label":"…"}],"coreInterpretation":"…"}',
    },
};

export const CHART_TYPE_ORDER: ChartType[] = [
    'life_fortune_trend',
    'fortune_radar',
    'fortune_calendar',
    'wuxing_energy',
    'life_timeline',
    'compatibility_gauge',
    'divination_verdict',
    'mbti_spectrum',
    'tarot_elements',
    'personality_petal',
    'yearly_sparklines',
    'physiognomy_annotation',
    'fortune_comparison',
    'cross_system',
    'dream_association',
];

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

/**
 * 统一的「可视化」提示段：先内置图表，内置表达不了再写 ```visual。
 * `allowedChartTypes` 为空表示只是用户开启了可视化偏好，按可选输出处理并列出全部类型；
 * `required` 显式覆盖是否要求至少输出一个内置图表（Agent 指令用可选）。
 */
export function buildVisualizationPromptSection(allowedChartTypes: ChartType[] = [], options: { required?: boolean } = {}) {
    if (!VISUALIZATION_OUTPUT_ENABLED) return '';
    const required = options.required ?? allowedChartTypes.length > 0;
    const types = allowedChartTypes.length > 0 ? allowedChartTypes : CHART_TYPE_ORDER;
    const lines: string[] = [];

    lines.push('【可视化】');
    lines.push(required
        ? '分析中优先用内置图表展示最有价值的数据；有合适的内置类型时，至少输出一个 ```chart 代码块。'
        : '当分析适合用图表达时，输出 ```chart 代码块。');
    lines.push('代码块内容是合法 JSON，格式为 {"chartType":"类型","title":"标题","data":{…}}，只用下列内置类型，并按各自的 data 结构原样填写：');
    for (const type of types) {
        const hint = CHART_PROMPT_HINTS[type];
        lines.push(`- ${type}（${hint.label}）：${hint.when}`);
        lines.push(`  data: ${hint.schema}`);
    }

    lines.push(`chartType 只能取上面列出的值，不能自造（例如 network、bar）；哪一种都不合适时改用下面的 \`\`\`visual 或文字说明。${allowedChartTypes.length ? '' : `可用的 chartType：${CHART_TYPES.join('、')}。`}`);
    lines.push('内置类型表达不了时（例如交互式大运时间轴、关系网络、对比滑块），改用 \`\`\`visual 代码块，内容是自包含的 HTML 片段：');
    lines.push('- 首行可写 <!-- 标题 --> 作为卡片标题，之后可用内联 CSS、SVG 与内联脚本。');
    lines.push('- 外壳是 sandbox iframe：不能联网，不能访问页面或站点存储，不能加载外部资源。');
    lines.push('- 总大小不超过 64 KB；只放在一个代码块里。');
    lines.push('- 颜色使用主题变量：var(--color-background)、var(--color-background-secondary)、var(--color-foreground)、var(--color-foreground-secondary)、var(--color-border)、var(--color-accent)，深色主题会自动切换。');
    lines.push('不要输出注释、省略号或无法解析的占位字段；除首行的标题注释外不写注释。');
    lines.push('优先给出最有价值的 1-2 个图。');
    return lines.join('\n');
}

/** Agent 系统提示使用同一条可视化约定；回答完成后才渲染，正文负责说明图在讲什么。 */
export function buildAgentVisualizationInstructions() {
    if (!VISUALIZATION_OUTPUT_ENABLED) return '';
    return `需要图表时按下面的可视化约定输出；回答完成后才会渲染，正文里说明图在讲什么即可。\n${buildVisualizationPromptSection(CHART_TYPE_ORDER, { required: false })}`;
}
