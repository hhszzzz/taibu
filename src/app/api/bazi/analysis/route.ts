/**
 * AI八字分析API
 *
 * 支持五行分析和人格分析
 * 支持流式输出 + 结果保存
 */

import { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-utils';
import {
    createDirectInterpretHandlers,
    createInterpretHandler,
    type DivinationRouteConfig,
    type InterpretInput,
} from '@/lib/api/divination-pipeline';
import { formatBaziPromptText } from '@/lib/bazi-prompt';
import { loadResolvedChartPromptDetailLevel } from '@/lib/ai/chart-prompt-detail';
import { getBaziCaseProfileByChartId } from '@/lib/server/bazi-case-profile';
import { USER_SETTINGS_SELECT, normalizeUserSettings } from '@/lib/user/settings';
import { buildVisualizationPreferencePrompts } from '@/lib/visualization/prompt';
import { SOURCE_CHART_TYPE_MAP, type ChartType } from '@/lib/visualization/chart-types';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';
import { generateBaziAnalysisTitle } from '@/lib/ai/ai-analysis';

const RATE_LIMIT_CONFIG = {
    maxRequests: 10,
    windowMs: 60 * 1000,
};

const WUXING_PROMPT = `你是一位专业的命理分析师，擅长八字五行分析。请根据用户提供的八字信息，进行专业的五行分析。

分析要求：
1. 分析五行的整体配置和平衡状态
2. 判断五行的强弱对比，结合日主在月令的十二长生状态（长生、帝旺为旺，病、死、绝为衰）
3. 确定喜用神和忌神
4. 分析地支关系（三合局、六合、六冲）对五行的影响：
   - 三合局（申子辰水、亥卯未木、寅午戌火、巳酉丑金）力量最强
   - 六合可增强相关五行
   - 六冲主动荡变化
5. 给出五行调理建议（颜色、方位、职业等）
6. 分析五行对性格和命运的影响

输出格式：
- 使用清晰的段落结构
- 每个要点单独成段
- 语言专业但通俗易懂
- 总字数控制在500-800字`;

const PERSONALITY_PROMPT = `你是一位专业的命理分析师，擅长通过八字分析人格特征。请根据用户提供的八字信息，进行深度人格分析。

分析要求：
1. 分析核心性格特征（3-5个主要特质），结合日主十二长生状态：
   - 长生、帝旺：有冲劲、主动积极
   - 沐浴、冠带：注重外表、追求进步
   - 衰、病、死：内敛稳重、深思熟虑
   - 墓、绝、胎、养：潜力待发、厚积薄发
2. 分析优势与潜质
3. 分析需要注意的性格盲点
4. 结合地支关系分析人际关系：
   - 三合局主团结协作
   - 六合主亲和人缘
   - 六冲主性格冲突或变动
5. 分析适合的发展方向

输出格式：
- 使用清晰的段落结构
- 每个特质单独成段并有具体说明
- 语言温暖亲切，富有洞察力
- 总字数控制在500-800字`;

type BaziAnalysisType = 'wuxing' | 'personality';

interface BaziAnalysisRequest {
    action?: 'direct_prepare' | 'direct_persist';
    chartId?: string;
    type?: BaziAnalysisType;
    modelId?: string;
    reasoning?: boolean;
    stream?: boolean;
}

interface BaziAnalysisInput extends InterpretInput {
    chartId: string;
    type: BaziAnalysisType;
}

type LoadedBaziChart = {
    id: string;
    name: string | null;
    user_id: string;
    gender: 'male' | 'female' | null;
    birth_date: string;
    birth_time: string | null;
    birth_place: string | null;
    longitude: number | null;
    calendar_type: string | null;
    is_leap_month: boolean | null;
};

type BaziAnalysisContext = {
    userId: string;
    chartPromptDetailLevel: Awaited<ReturnType<typeof loadResolvedChartPromptDetailLevel>>;
    chart: LoadedBaziChart;
    chartSummary: string;
    chartName: string;
    caseProfileId: string | null;
    caseProfileUpdatedAt: string | null;
    visualizationPrompts: ReturnType<typeof buildVisualizationPreferencePrompts>;
};

function getAllowedChartTypes(type: BaziAnalysisType): ChartType[] {
    return type === 'wuxing'
        ? [...SOURCE_CHART_TYPE_MAP.bazi_chart, 'fortune_calendar']
        : ['personality_petal', 'life_timeline', 'fortune_radar', 'fortune_calendar'];
}

const baziAnalysisConfig: DivinationRouteConfig<BaziAnalysisInput, BaziAnalysisContext> = {
    sourceType: (input) => (input.type === 'wuxing' ? 'bazi_wuxing' : 'bazi_personality'),
    tag: 'bazi/analysis',
    personality: 'bazi',
    authMethod: 'userContext',
    parseInput: (body) => {
        const request = body as BaziAnalysisRequest;
        if (!request.chartId || typeof request.chartId !== 'string') {
            return { error: '缺少命盘ID', status: 400 };
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.chartId)) {
            return { error: '命盘ID格式无效', status: 400 };
        }
        if (!request.type || !['wuxing', 'personality'].includes(request.type)) {
            return { error: '分析类型无效', status: 400 };
        }
        return {
            chartId: request.chartId,
            type: request.type,
        };
    },
    postAdmissionRateLimit: async (request) => {
        const clientIP = getClientIP(request);
        const rateLimit = await checkRateLimit(clientIP, '/api/bazi/analysis', RATE_LIMIT_CONFIG);
        return rateLimit.allowed ? null : { error: '请求过于频繁，请稍后再试', status: 429 };
    },
    resolvePromptContext: async (input, auth) => {
        const { userId, db } = auth;
        if (!db) {
            return { error: '认证上下文缺失', status: 500 };
        }
        const supabase = db;
        const { data: chart, error: chartError } = await supabase
            .from('bazi_charts')
            .select('id, name, user_id, gender, birth_date, birth_time, birth_place, longitude, calendar_type, is_leap_month')
            .eq('id', input.chartId)
            .eq('user_id', userId)
            .single();
        if (chartError || !chart?.user_id) {
            return { error: '未找到命盘信息', status: 404 };
        }

        const resolvedChart = chart as LoadedBaziChart;
        if (!resolvedChart.birth_time || !resolvedChart.birth_time.trim()) {
            return { error: '该八字命盘缺少出生时辰，暂不支持 AI 分析', status: 400 };
        }
        const caseProfile = await getBaziCaseProfileByChartId(supabase, input.chartId, userId);
        const chartPromptDetailLevel = await loadResolvedChartPromptDetailLevel(userId, 'bazi', { client: supabase });
        const chartSummary = formatBaziPromptText({
            id: resolvedChart.id,
            name: resolvedChart.name || '命盘',
            gender: resolvedChart.gender || 'male',
            birthDate: resolvedChart.birth_date,
            birthTime: resolvedChart.birth_time,
            birthPlace: resolvedChart.birth_place || undefined,
            longitude: resolvedChart.longitude ?? undefined,
            calendarType: (resolvedChart.calendar_type as 'solar' | 'lunar' | undefined) || 'solar',
            isLeapMonth: resolvedChart.is_leap_month || false,
        }, caseProfile, chartPromptDetailLevel);

        const { data: userSettingsRow } = await supabase
            .from('user_settings')
            .select(USER_SETTINGS_SELECT)
            .eq('user_id', userId)
            .maybeSingle();
        const userSettings = normalizeUserSettings((userSettingsRow ?? null) as Record<string, unknown> | null);

        return {
            userId,
            chartPromptDetailLevel,
            chart: resolvedChart,
            chartSummary,
            chartName: resolvedChart.name || '命盘',
            caseProfileId: caseProfile?.id || null,
            caseProfileUpdatedAt: caseProfile?.updatedAt || null,
            visualizationPrompts: buildVisualizationPreferencePrompts(userSettings.visualizationSettings),
        };
    },
    buildPrompts: (input, context) => {
        const systemPrompt = [
            input.type === 'wuxing' ? WUXING_PROMPT : PERSONALITY_PROMPT,
            context?.visualizationPrompts.dimensionsPrompt,
            context?.visualizationPrompts.dayunPrompt,
            context?.visualizationPrompts.chartStylePrompt,
        ].filter(Boolean).join('\n\n');

        return {
            systemPrompt,
            userPrompt: `请分析以下八字：\n\n${context?.chartSummary || ''}`,
        };
    },
    allowedChartTypes: (input) => getAllowedChartTypes(input.type),
    buildSourceData: (input, modelId, reasoningEnabled, context) => ({
        chart_id: input.chartId,
        chart_name: context?.chartName || null,
        chart_summary: context?.chartSummary || null,
        case_profile_id: context?.caseProfileId || null,
        case_profile_updated_at: context?.caseProfileUpdatedAt || null,
        case_prompt_snapshot: context?.chartSummary || null,
        model_id: modelId,
        reasoning: reasoningEnabled,
    }),
    generateTitle: (input, context) => generateBaziAnalysisTitle(context?.chartName || '命盘', input.type),
    formatSuccessResponse: ({ content, reasoning, conversationId }) => ({
        success: true,
        content,
        reasoning,
        conversationId,
    }),
};

const handleAnalyze = createInterpretHandler<BaziAnalysisInput, BaziAnalysisContext>(baziAnalysisConfig);
const { handleDirectPrepare, handleDirectPersist } = createDirectInterpretHandlers<BaziAnalysisInput, BaziAnalysisContext>(baziAnalysisConfig);

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as Record<string, unknown> & { action?: BaziAnalysisRequest['action'] };
        if (body.action === 'direct_prepare') {
            return await handleDirectPrepare(request, body);
        }
        if (body.action === 'direct_persist') {
            return await handleDirectPersist(request, body);
        }
        return await handleAnalyze(request, body);
    } catch (error) {
        console.error('Analysis API error:', error);
        return jsonError('服务器错误', 500);
    }
}
