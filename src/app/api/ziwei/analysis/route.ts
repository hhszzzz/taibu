/**
 * 紫微斗数 AI 分析 API
 *
 * 基于命盘数据进行 AI 解读，使用 createInterpretHandler 管道
 */

import { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-utils';
import { createInterpretHandler, type InterpretInput } from '@/lib/api/divination-pipeline';
import { loadResolvedChartPromptDetailLevel } from '@/lib/ai/chart-prompt-detail';
import { generateZiweiAnalysisTitle } from '@/lib/ai/ai-analysis';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';
import {
    calculateZiweiChartBundle,
    generateZiweiChartText,
    type ZiweiFormData,
} from '@/lib/divination/ziwei';

const RATE_LIMIT_CONFIG = {
    maxRequests: 10,
    windowMs: 60 * 1000,
};

const SYSTEM_PROMPT = `你是一位专业的紫微斗数命理分析师，擅长通过紫微斗数命盘分析人生运势。请根据用户提供的命盘信息，进行专业的分析解读。

分析要求：
1. 分析命宫主星及其组合的性格特征
2. 分析命盘格局（如紫府同宫、机月同梁等经典格局）
3. 分析四化飞星（禄权科忌）对各宫位的影响
4. 分析事业、财帛、感情等重点宫位
5. 结合大限和流年运势给出建议
6. 指出命盘中的优势与需要注意的方面

输出格式：
- 使用清晰的段落结构
- 每个分析维度单独成段
- 语言专业但通俗易懂
- 总字数控制在800-1200字`;

interface ZiweiAnalysisRequest {
    chartId?: string;
    modelId?: string;
    reasoning?: boolean;
    stream?: boolean;
}

interface ZiweiAnalysisInput extends InterpretInput {
    chartId: string;
}

type LoadedZiweiChart = {
    id: string;
    name: string;
    user_id: string;
    gender: string | null;
    birth_date: string;
    birth_time: string;
    birth_place: string | null;
    calendar_type: string | null;
    is_leap_month: boolean | null;
    longitude: number | null;
};

type ZiweiAnalysisContext = {
    userId: string;
    chartPromptDetailLevel: Awaited<ReturnType<typeof loadResolvedChartPromptDetailLevel>>;
    chart: LoadedZiweiChart;
    chartSummary: string;
    chartName: string;
};

function parseTimeToHourMinute(birthTime: string): { hour: number; minute: number } {
    const parts = birthTime.split(':');
    return {
        hour: parseInt(parts[0] ?? '0', 10),
        minute: parseInt(parts[1] ?? '0', 10),
    };
}

const handleAnalyze = createInterpretHandler<ZiweiAnalysisInput, ZiweiAnalysisContext>({
    sourceType: 'ziwei',
    tag: 'ziwei/analysis',
    personality: 'ziwei',
    authMethod: 'userContext',
    allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.ziwei_chart],
    parseInput: (body) => {
        const request = body as ZiweiAnalysisRequest;
        if (!request.chartId || typeof request.chartId !== 'string') {
            return { error: '缺少命盘ID', status: 400 };
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.chartId)) {
            return { error: '命盘ID格式无效', status: 400 };
        }
        return { chartId: request.chartId };
    },
    postAdmissionRateLimit: async (request) => {
        const clientIP = getClientIP(request);
        const rateLimit = await checkRateLimit(clientIP, '/api/ziwei/analysis', RATE_LIMIT_CONFIG);
        return rateLimit.allowed ? null : { error: '请求过于频繁，请稍后再试', status: 429 };
    },
    resolvePromptContext: async (input, auth) => {
        const { userId, db } = auth;
        if (!db) {
            return { error: '认证上下文缺失', status: 500 };
        }
        const supabase = db;
        const { data: chart, error: chartError } = await supabase
            .from('ziwei_charts')
            .select('id, name, user_id, gender, birth_date, birth_time, birth_place, calendar_type, is_leap_month, longitude')
            .eq('id', input.chartId)
            .eq('user_id', userId)
            .single();
        if (chartError || !chart?.user_id) {
            return { error: '未找到命盘信息', status: 404 };
        }

        const resolvedChart = chart as LoadedZiweiChart;
        if (!resolvedChart.birth_time || !resolvedChart.birth_time.trim()) {
            return { error: '该命盘缺少出生时辰，暂不支持 AI 分析', status: 400 };
        }

        const { hour, minute } = parseTimeToHourMinute(resolvedChart.birth_time);
        // 手动解析日期字符串，避免 new Date(string) 的时区歧义
        const [birthYear, birthMonth, birthDay] = resolvedChart.birth_date.split('-').map(Number);

        const formData: ZiweiFormData = {
            name: resolvedChart.name,
            gender: (resolvedChart.gender as 'male' | 'female') || 'male',
            birthYear,
            birthMonth,
            birthDay,
            birthHour: hour,
            birthMinute: minute,
            calendarType: (resolvedChart.calendar_type as 'solar' | 'lunar') || 'solar',
            isLeapMonth: resolvedChart.is_leap_month || false,
            birthPlace: resolvedChart.birth_place || undefined,
            longitude: resolvedChart.longitude ?? undefined,
        };

        const { output, astrolabe } = calculateZiweiChartBundle(formData);
        const chartPromptDetailLevel = await loadResolvedChartPromptDetailLevel(userId, 'ziwei', { client: supabase });
        const chartSummary = generateZiweiChartText(output, {
            includeHoroscope: true,
            detailLevel: chartPromptDetailLevel,
            astrolabe,
        });

        return {
            userId,
            chartPromptDetailLevel,
            chart: resolvedChart,
            chartSummary,
            chartName: resolvedChart.name || '命盘',
        };
    },
    buildPrompts: (_input, context) => ({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: `请分析以下紫微斗数命盘：\n\n${context?.chartSummary || ''}`,
    }),
    buildSourceData: (input, modelId, reasoningEnabled, context) => ({
        chart_id: input.chartId,
        chart_name: context?.chartName || null,
        chart_summary: context?.chartSummary || null,
        model_id: modelId,
        reasoning: reasoningEnabled,
    }),
    generateTitle: (_input, context) => generateZiweiAnalysisTitle(context?.chartName || '命盘'),
    formatSuccessResponse: ({ content, reasoning, conversationId }) => ({
        success: true,
        content,
        reasoning,
        conversationId,
    }),
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as Record<string, unknown>;
        return await handleAnalyze(request, body);
    } catch (error) {
        console.error('Ziwei analysis API error:', error);
        return jsonError('服务器错误', 500);
    }
}
