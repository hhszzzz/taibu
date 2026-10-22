/**
 * 手相分析 API 路由
 *
 * 提供手相图片分析、历史记录等功能
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { DEFAULT_VISION_MODEL_ID } from '@/lib/ai/ai-config';
import {
    PALM_ANALYSIS_TYPES,
    buildPalmSystemPrompt,
    buildPalmUserPrompt,
    generatePalmTitle,
    type HandType,
} from '@/lib/divination/palm';
import { createInterpretHandler, type InterpretInput } from '@/lib/api/divination-pipeline';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/jpg']);

interface PalmInterpretInput extends InterpretInput {
    imageBase64: string;
    imageMimeType: string;
    analysisType: string;
    handType: HandType;
    question?: string;
}

const handleAnalyze = createInterpretHandler<PalmInterpretInput>({
    sourceType: 'palm',
    tag: 'palm',
    allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.palm_reading],
    defaultModelId: DEFAULT_VISION_MODEL_ID,
    isVision: true,
    modelAccessOptions: {
        requireVision: true,
        membershipDeniedMessage: '手相分析需要 Plus 会员或以上',
    },
    parseInput: (body) => {
        const b = body as Record<string, unknown>;
        const imageBase64 = b.imageBase64 as string | undefined;
        if (!imageBase64) {
            return { error: '请上传手相图片', status: 400 };
        }
        const raw = typeof b.imageMimeType === 'string' ? b.imageMimeType.trim().toLowerCase() : '';
        if (!raw || !SUPPORTED_IMAGE_MIME_TYPES.has(raw)) {
            return { error: '图片格式不支持', status: 400 };
        }
        return {
            imageBase64,
            imageMimeType: raw,
            analysisType: (b.analysisType as string) || 'full',
            handType: ((b.handType as string) || 'left') as HandType,
            question: b.question as string | undefined,
        };
    },
    buildPrompts: (input) => ({
        systemPrompt: buildPalmSystemPrompt(input.analysisType),
        userPrompt: buildPalmUserPrompt(input.analysisType, input.handType, input.question),
    }),
    buildVisionOptions: (input) => ({
        imageBase64: input.imageBase64,
        imageMimeType: input.imageMimeType,
    }),
    buildSourceData: (input, modelId, reasoningEnabled) => ({
        analysis_type: input.analysisType,
        hand_type: input.handType,
        question: input.question || null,
        model_id: modelId,
        reasoning: reasoningEnabled,
    }),
    generateTitle: (input) => generatePalmTitle(input.analysisType, input.handType),
    buildHistoryBinding: (input) => ({
        type: 'palm',
        payload: {
            analysis_type: input.analysisType,
            hand_type: input.handType,
        },
    }),
});

export async function POST(request: NextRequest): Promise<Response> {
    try {
        const body = await request.json();
        const { action } = body;

        switch (action) {
            case 'list-types':
                return jsonOk({ success: true, data: { types: PALM_ANALYSIS_TYPES } });
            case 'analyze':
                return handleAnalyze(request, body);
            default:
                return jsonError('未知的操作类型', 400, { success: false });
        }
    } catch (error) {
        console.error('手相分析 API 错误:', error);
        return jsonError('服务器错误', 500, { success: false });
    }
}

export async function GET(): Promise<Response> {
    return jsonOk({ success: true, data: { types: PALM_ANALYSIS_TYPES } });
}
