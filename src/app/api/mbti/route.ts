/**
 * MBTI 性格测试 API 路由
 *
 * 提供 AI 性格分析功能
 */
import { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-utils';
import { type MBTIType, PERSONALITY_BASICS } from '@/lib/divination/mbti';
import {
    createDirectInterpretHandlers,
    createInterpretHandler,
    type DivinationRouteConfig,
    type InterpretInput,
    saveUserOwnedDivinationRecord,
} from '@/lib/api/divination-pipeline';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';

interface MBTIRequest {
    action: 'analyze' | 'analyze_prepare' | 'analyze_persist' | 'save';
    type: MBTIType;
    scores: Record<string, number>;
    percentages: {
        EI: { E: number; I: number };
        SN: { S: number; N: number };
        TF: { T: number; F: number };
        JP: { J: number; P: number };
    };
    readingId?: string;
    modelId?: string;
    reasoning?: boolean;
    stream?: boolean;
}

// ─── Interpret pipeline config ───

interface MBTIInterpretInput extends InterpretInput {
    type: MBTIType;
    scores: Record<string, number>;
    percentages: MBTIRequest['percentages'];
    readingId?: string;
}

const mbtiInterpretConfig: DivinationRouteConfig<MBTIInterpretInput> = {
    sourceType: 'mbti',
    tag: 'mbti',
    personality: 'mbti',
    allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.mbti_reading],
    parseInput: (body) => {
        const b = body as MBTIRequest;
        if (!b.type || !b.percentages) {
            return { error: '请提供完整的测试结果', status: 400 };
        }
        return {
            type: b.type,
            scores: b.scores,
            percentages: b.percentages,
            readingId: b.readingId,
        };
    },
    buildPrompts: (input) => {
        const basic = PERSONALITY_BASICS[input.type];

        const userPrompt = `用户的 MBTI 测试结果：

性格类型：${input.type} - ${basic.title}
${basic.description}

维度分析：
- 外向(E) ${input.percentages.EI.E}% vs 内向(I) ${input.percentages.EI.I}%
- 实感(S) ${input.percentages.SN.S}% vs 直觉(N) ${input.percentages.SN.N}%
- 思考(T) ${input.percentages.TF.T}% vs 情感(F) ${input.percentages.TF.F}%
- 判断(J) ${input.percentages.JP.J}% vs 知觉(P) ${input.percentages.JP.P}%

请为这位用户提供个性化的深度分析。`;

        return { systemPrompt: '', userPrompt };
    },
    buildSourceData: (input, modelId, reasoningEnabled) => ({
        mbti_type: input.type,
        scores: input.scores,
        percentages: input.percentages,
        model_id: modelId,
        reasoning: reasoningEnabled,
    }),
    generateTitle: (input) => `${input.type} 人格分析`,
    buildHistoryBinding: (input) => ({
        type: 'mbti',
        payload: input.readingId
            ? { reading_id: input.readingId }
            : {
                mbti_type: input.type,
                scores: input.scores,
                percentages: input.percentages,
            },
    }),
};

const handleInterpret = createInterpretHandler<MBTIInterpretInput>(mbtiInterpretConfig);
const { handleDirectPrepare, handleDirectPersist } = createDirectInterpretHandlers<MBTIInterpretInput>(mbtiInterpretConfig);

const mbtiSaveConfig = {
    tag: 'mbti',
    tableName: 'mbti_readings',
    responseKey: 'readingId' as const,
    validate: (input: MBTIRequest) => (!input.type || !input.percentages)
        ? { error: '请提供完整的测试结果', status: 400 }
        : null,
    buildInsertPayload: (input: MBTIRequest, userId: string) => ({
        user_id: userId,
        mbti_type: input.type,
        scores: input.scores,
        percentages: input.percentages,
    }),
};

export async function POST(request: NextRequest) {
    try {
        const body: MBTIRequest = await request.json();
        const { action } = body;

        if (action === 'save') {
            return saveUserOwnedDivinationRecord({
                request,
                input: body,
                ...mbtiSaveConfig,
            });
        }

        if (action === 'analyze_prepare') {
            return handleDirectPrepare(request, body as unknown as Record<string, unknown>);
        }

        if (action === 'analyze_persist') {
            return handleDirectPersist(request, body as unknown as Record<string, unknown>);
        }

        if (action !== 'analyze') {
            return jsonError('未知操作', 400, { success: false });
        }

        return handleInterpret(request, body as unknown as Record<string, unknown>);
    } catch (error) {
        console.error('[mbti] API 错误:', error);
        return jsonError('服务器错误', 500, { success: false });
    }
}
