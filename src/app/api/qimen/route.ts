/**
 * 奇门遁甲 API 路由
 *
 * action: 'calculate' — 排盘计算
 * action: 'interpret' — AI 解读（流式）
 * action: 'save'     — 保存记录
 */
import { NextRequest } from 'next/server';
import { DEFAULT_DIVINATION_TIMEZONE, zonedTimeToUtc } from 'taibu-core/timezone-utils';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import {
    calculateQimenBundle,
    generateQimenChartText,
    toStoredQimenZhiFuJiGong,
    type QimenInput,
    type QimenOutput,
} from '@/lib/divination/qimen';
import {
    createDirectInterpretHandlers,
    createInterpretHandler,
    type DivinationRouteConfig,
    type InterpretInput,
    type InterpretPromptContext,
    saveUserOwnedDivinationRecord,
} from '@/lib/api/divination-pipeline';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';
import { loadResolvedChartPromptDetailLevel } from '@/lib/ai/chart-prompt-detail';

interface QimenRequest {
    action: 'calculate' | 'interpret' | 'interpret_prepare' | 'interpret_persist' | 'save';
    year?: number;
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
    timezone?: string;
    question?: string;
    panType?: 'zhuan';
    juMethod?: 'chaibu' | 'maoshan';
    zhiFuJiGong?: 'jiLiuYi' | 'jiWuGong';
    modelId?: string;
    reasoning?: boolean;
    stream?: boolean;
    chartId?: string;
}

type RouteError = { error: string; status: number };

interface QimenInterpretInput extends InterpretInput, QimenInput {
    chartId?: string;
}

interface QimenInterpretContext extends InterpretPromptContext {
    chart: QimenOutput;
}

function isRouteError(value: unknown): value is RouteError {
    return Boolean(value && typeof value === 'object' && 'error' in value && 'status' in value);
}

function isIntegerField(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value);
}

function requireQimenInterpretContext(context?: QimenInterpretContext): QimenInterpretContext {
    if (!context) {
        throw new Error('Missing qimen interpret context');
    }
    return context;
}

function parseQimenInput(body: QimenRequest): QimenInput | RouteError {
    const { year, month, day, hour, minute, panType, juMethod, zhiFuJiGong } = body;
    if (
        !isIntegerField(year)
        || !isIntegerField(month)
        || !isIntegerField(day)
        || !isIntegerField(hour)
        || !isIntegerField(minute)
    ) {
        return { error: '请提供完整的日期时间', status: 400 };
    }
    if (panType && panType !== 'zhuan') {
        return { error: '当前仅支持转盘', status: 400 };
    }
    if (juMethod && juMethod !== 'chaibu' && juMethod !== 'maoshan') {
        return { error: '定局法无效', status: 400 };
    }
    if (zhiFuJiGong && zhiFuJiGong !== 'jiLiuYi' && zhiFuJiGong !== 'jiWuGong') {
        return { error: '中五寄宫配置无效', status: 400 };
    }

    const timezone = typeof body.timezone === 'string' && body.timezone.trim()
        ? body.timezone.trim()
        : undefined;
    const question = typeof body.question === 'string' && body.question.trim()
        ? body.question.trim()
        : undefined;

    return {
        year,
        month,
        day,
        hour,
        minute,
        timezone,
        question,
        panType: panType || 'zhuan',
        juMethod: juMethod || 'chaibu',
        zhiFuJiGong: zhiFuJiGong || 'jiWuGong',
    };
}

async function calculateQimenOutput(input: QimenInput): Promise<QimenOutput> {
    const { output } = await calculateQimenBundle(input);
    return output;
}

function buildChartInfoText(chart: QimenOutput, question?: string, detailLevel?: 'default' | 'more' | 'full'): string {
    return generateQimenChartText(chart, { question, detailLevel });
}

function getChartTime(input: QimenInput): string {
    return zonedTimeToUtc({
        year: input.year,
        month: input.month,
        day: input.day,
        hour: input.hour,
        minute: input.minute,
    }, input.timezone || DEFAULT_DIVINATION_TIMEZONE).toISOString();
}

function buildInsertPayload(
    userId: string,
    input: QimenInput,
    chart: QimenOutput,
    conversationId: string | null = null,
) {
    return {
        user_id: userId,
        question: input.question || null,
        chart_time: getChartTime(input),
        year: input.year,
        month: input.month,
        day: input.day,
        hour: input.hour,
        minute: input.minute,
        timezone: input.timezone || DEFAULT_DIVINATION_TIMEZONE,
        dun_type: chart.dunType,
        ju_number: chart.juNumber,
        pan_type: input.panType,
        ju_method: input.juMethod,
        zhi_fu_ji_gong: toStoredQimenZhiFuJiGong(input.zhiFuJiGong),
        conversation_id: conversationId,
    };
}

const qimenInterpretConfig: DivinationRouteConfig<QimenInterpretInput, QimenInterpretContext> = {
    sourceType: 'qimen',
    tag: 'qimen',
    authMethod: 'userContext',
    personality: 'qimen',
    allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.qimen_chart],
    parseInput: (body) => {
        const request = body as QimenRequest;
        const parsed = parseQimenInput(request);
        if (isRouteError(parsed)) return parsed;
        return {
            ...parsed,
            chartId: typeof request.chartId === 'string' && request.chartId.trim()
                ? request.chartId
                : undefined,
        };
    },
    resolvePromptContext: async (input, auth) => ({
        userId: auth.userId,
        chartPromptDetailLevel: await loadResolvedChartPromptDetailLevel(auth.userId, 'qimen', {
            client: auth.db ?? undefined,
        }),
        chart: await calculateQimenOutput(input),
    }),
    buildPrompts: (input, context) => {
        const resolvedContext = requireQimenInterpretContext(context);
        const chartInfo = buildChartInfoText(
            resolvedContext.chart,
            input.question,
            resolvedContext.chartPromptDetailLevel,
        );
        return {
            systemPrompt: '',
            userPrompt: `${chartInfo}\n\n请根据以上奇门遁甲排盘信息，为求测者详细解读此局。`,
        };
    },
    buildSourceData: (input, modelId, reasoningEnabled, context) => {
        const resolvedContext = requireQimenInterpretContext(context);
        return {
            dun_type: resolvedContext.chart.dunType,
            ju_number: resolvedContext.chart.juNumber,
            pan_type_label: resolvedContext.chart.panType,
            ju_method_label: resolvedContext.chart.juMethod,
            four_pillars: resolvedContext.chart.siZhu,
            question: input.question || null,
            model_id: modelId,
            reasoning: reasoningEnabled,
        };
    },
    generateTitle: (input, context) => {
        const resolvedContext = requireQimenInterpretContext(context);
        if (input.question) {
            return `奇门遁甲 - ${input.question.slice(0, 20)}${input.question.length > 20 ? '...' : ''}`;
        }
        return `奇门遁甲 - ${resolvedContext.chart.dunType === 'yang' ? '阳遁' : '阴遁'}${resolvedContext.chart.juNumber}局`;
    },
    buildHistoryBinding: (input, userId, context) => {
        const resolvedContext = requireQimenInterpretContext(context);
        return {
            type: 'qimen',
            payload: input.chartId
                ? {
                    chart_id: input.chartId,
                }
                : buildInsertPayload(userId, input, resolvedContext.chart),
        };
    },
};

const handleInterpret = createInterpretHandler<QimenInterpretInput, QimenInterpretContext>(qimenInterpretConfig);
const { handleDirectPrepare, handleDirectPersist } = createDirectInterpretHandlers<QimenInterpretInput, QimenInterpretContext>(qimenInterpretConfig);

export async function POST(request: NextRequest) {
    try {
        const body: QimenRequest = await request.json();

        switch (body.action) {
            case 'calculate': {
                const parsed = parseQimenInput(body);
                if (isRouteError(parsed)) {
                    return jsonError(parsed.error, parsed.status, { success: false });
                }

                const authResult = await requireUserContext(request);
                if ('error' in authResult) {
                    return jsonError(authResult.error.message, authResult.error.status, { success: false });
                }

                const output = await calculateQimenOutput(parsed);
                return jsonOk({ success: true, data: output });
            }

            case 'interpret':
                return handleInterpret(request, body as unknown as Record<string, unknown>);

            case 'interpret_prepare':
                return handleDirectPrepare(request, body as unknown as Record<string, unknown>);

            case 'interpret_persist':
                return handleDirectPersist(request, body as unknown as Record<string, unknown>);

            case 'save': {
                const parsed = parseQimenInput(body);
                if (isRouteError(parsed)) {
                    return jsonError(parsed.error, parsed.status, { success: false });
                }

                const output = await calculateQimenOutput(parsed);
                return saveUserOwnedDivinationRecord({
                    request,
                    tag: 'qimen',
                    tableName: 'qimen_charts',
                    responseKey: 'chartId',
                    input: body as unknown as Record<string, unknown>,
                    buildInsertPayload: (_input, userId) => buildInsertPayload(userId, parsed, output),
                });
            }

            default:
                return jsonError('未知操作', 400, { success: false });
        }
    } catch (error) {
        console.error('[qimen] API 错误:', error);
        if (error instanceof Error && /(timezone|日期无效|格式无效)/u.test(error.message)) {
            return jsonError(error.message, 400, { success: false });
        }
        return jsonError('服务器错误', 500, { success: false });
    }
}
