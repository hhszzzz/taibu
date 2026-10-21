/**
 * 大六壬排盘 API 路由
 *
 * action: calculate | interpret | save
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import {
    createDirectInterpretHandlers,
    createInterpretHandler,
    type DivinationRouteConfig,
    type InterpretInput,
    saveUserOwnedDivinationRecord,
} from '@/lib/api/divination-pipeline';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';
import { loadResolvedChartPromptDetailLevel } from '@/lib/ai/chart-prompt-detail';
import {
    calculateDaliurenBundle,
    generateDaliurenChartText,
    type DaliurenOutput,
} from '@/lib/divination/daliuren';

interface DaliurenRequest {
    action: 'calculate' | 'interpret' | 'interpret_prepare' | 'interpret_persist' | 'save';
    date?: string;
    hour?: number;
    minute?: number;
    timezone?: string;
    question?: string;
    birthYear?: number;
    gender?: 'male' | 'female';
    divinationId?: string;
    modelId?: string;
    reasoning?: boolean;
    resultData?: DaliurenOutput;
}

// ─── Interpret pipeline config ───

interface DaliurenInterpretInput extends InterpretInput {
    resultData: DaliurenOutput;
    question?: string;
    divinationId?: string;
}

function buildDaliurenPrompt(result: DaliurenOutput, question?: string, detailLevel?: 'default' | 'more' | 'full'): string {
    return `${generateDaliurenChartText(result, {
        question: question || result.question,
        detailLevel,
    })}\n\n请详细解读。`;
}

const daliurenInterpretConfig: DivinationRouteConfig<DaliurenInterpretInput> = {
    sourceType: 'daliuren',
    tag: 'daliuren',
    authMethod: 'userContext',
    personality: 'daliuren',
    allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.daliuren_divination],
    parseInput: (body) => {
        const b = body as DaliurenRequest;
        if (!b.resultData) {
            return { error: '请提供排盘数据', status: 400 };
        }
        return {
            resultData: b.resultData,
            question: b.question,
            divinationId: b.divinationId,
        };
    },
    resolvePromptContext: async (_input, auth) => ({
        userId: auth.userId,
        chartPromptDetailLevel: await loadResolvedChartPromptDetailLevel(auth.userId, 'daliuren', {
            db: auth.db,
        }),
    }),
    buildPrompts: (input, promptContext) => ({
        systemPrompt: '',
        userPrompt: buildDaliurenPrompt(input.resultData, input.question as string | undefined, promptContext?.chartPromptDetailLevel),
    }),
    buildSourceData: (input, modelId) => ({
        ke_name: input.resultData.keName,
        day_ganzhi: input.resultData.dateInfo.ganZhi.day,
        hour_ganzhi: input.resultData.dateInfo.ganZhi.hour,
        yue_jiang: input.resultData.dateInfo.yueJiang,
        question: input.question || null,
        model_id: modelId,
    }),
    generateTitle: (input) => `大六壬 · ${input.resultData.keName}`,
    buildHistoryBinding: (input) => input.divinationId
        ? {
            type: 'daliuren',
            payload: {
                divination_id: input.divinationId,
            },
        }
        : null,
};

const handleInterpret = createInterpretHandler<DaliurenInterpretInput>(daliurenInterpretConfig);
const { handleDirectPrepare, handleDirectPersist } = createDirectInterpretHandlers<DaliurenInterpretInput>(daliurenInterpretConfig);

const daliurenSaveConfig = {
    tag: 'daliuren',
    tableName: 'daliuren_divinations',
    responseKey: 'divinationId' as const,
    validate: (input: DaliurenRequest) => (!input.date || input.hour == null || !input.resultData)
        ? { error: '缺少排盘数据', status: 400 }
        : null,
    buildInsertPayload: (input: DaliurenRequest, userId: string) => ({
        user_id: userId,
        question: input.question || null,
        solar_date: input.date,
        day_ganzhi: input.resultData!.dateInfo.ganZhi.day,
        hour_ganzhi: input.resultData!.dateInfo.ganZhi.hour,
        yue_jiang: input.resultData!.dateInfo.yueJiang,
        result_data: input.resultData,
        settings: { hour: input.hour, minute: input.minute, timezone: input.timezone },
    }),
};

export async function POST(request: NextRequest) {
    try {
        const body: DaliurenRequest = await request.json();
        const { action } = body;

        switch (action) {
            case 'calculate': {
                const { date, hour, minute, timezone, question, birthYear, gender } = body;
                if (!date || hour == null) {
                    return jsonError('请提供日期和时辰', 400, { success: false });
                }
                const { output } = calculateDaliurenBundle({
                    date, hour, minute, timezone, question, birthYear, gender,
                });
                return jsonOk({ success: true, data: output });
            }

            case 'save': {
                return saveUserOwnedDivinationRecord({
                    request,
                    input: body,
                    ...daliurenSaveConfig,
                });
            }

            case 'interpret':
                return handleInterpret(request, body as unknown as Record<string, unknown>);

            case 'interpret_prepare':
                return handleDirectPrepare(request, body as unknown as Record<string, unknown>);

            case 'interpret_persist':
                return handleDirectPersist(request, body as unknown as Record<string, unknown>);

            default:
                return jsonError(`未知操作: ${action}`, 400, { success: false });
        }
    } catch (error) {
        console.error('[daliuren] 路由错误:', error);
        if (error instanceof Error && /(timezone|日期无效|格式无效|闰月|农历)/u.test(error.message)) {
            return jsonError(error.message, 400, { success: false });
        }
        return jsonError('服务器内部错误', 500, { success: false });
    }
}
