/**
 * 面相分析 API 路由
 *
 * 提供面相图片分析、历史记录等功能；自定义模型由浏览器带图直连，本站只备提示词与保存结果，不经手照片。
 */
import { NextRequest } from 'next/server';
import { DEFAULT_VISION_MODEL_ID } from '@/lib/ai/ai-config';
import {
    FACE_ANALYSIS_TYPES,
    buildFaceSystemPrompt,
    buildFaceUserPrompt,
    generateFaceTitle,
    FACE_DISCLAIMER
} from '@/lib/divination/face';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { createDirectInterpretHandlers, createInterpretHandler, parseVisionImageInput, visionOptions, type InterpretInput } from '@/lib/api/divination-pipeline';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';

interface FaceReadingInput extends InterpretInput {
    analysisType: string;
    question?: string;
}

interface FaceInterpretInput extends FaceReadingInput {
    imageBase64: string;
    imageMimeType: string;
}

const parseReading = (b: Record<string, unknown>): FaceReadingInput => ({
    analysisType: (b.analysisType as string) || 'full',
    question: b.question as string | undefined,
});

/** 平台分析与浏览器直连共用的提示词与保存方式。 */
const reading = {
    sourceType: 'face',
    tag: 'face',
    allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.face_reading],
    buildPrompts: (input: FaceReadingInput) => ({
        systemPrompt: buildFaceSystemPrompt(input.analysisType),
        userPrompt: buildFaceUserPrompt(input.analysisType, input.question),
    }),
    buildSourceData: (input: FaceReadingInput, modelId: string, reasoningEnabled: boolean) => ({
        analysis_type: input.analysisType,
        question: input.question || null,
        model_id: modelId,
        reasoning: reasoningEnabled,
    }),
    generateTitle: (input: FaceReadingInput) => generateFaceTitle(input.analysisType),
    buildHistoryBinding: (input: FaceReadingInput) => ({
        type: 'face' as const,
        payload: {
            analysis_type: input.analysisType,
        },
    }),
};

const handleAnalyze = createInterpretHandler<FaceInterpretInput>({
    ...reading,
    defaultModelId: DEFAULT_VISION_MODEL_ID,
    isVision: true,
    modelAccessOptions: {
        requireVision: true,
    },
    parseInput: (body) => {
        const b = body as Record<string, unknown>;
        const image = parseVisionImageInput(b, '请上传面部照片');
        if ('error' in image) return image;
        return { ...parseReading(b), ...image };
    },
    buildVisionOptions: visionOptions,
});

const direct = createDirectInterpretHandlers<FaceReadingInput>({
    ...reading,
    parseInput: (body) => parseReading(body as Record<string, unknown>),
});

export async function POST(request: NextRequest): Promise<Response> {
    try {
        const body = await request.json();
        const { action } = body;

        switch (action) {
            case 'list-types':
                return jsonOk({ success: true, data: { types: FACE_ANALYSIS_TYPES } });
            case 'disclaimer':
                return jsonOk({ success: true, data: { disclaimer: FACE_DISCLAIMER } });
            case 'analyze':
                return handleAnalyze(request, body);
            case 'direct-prepare':
                return direct.handleDirectPrepare(request, body);
            case 'direct-persist':
                return direct.handleDirectPersist(request, body);
            default:
                return jsonError('未知的操作类型', 400, { success: false });
        }
    } catch (error) {
        console.error('面相分析 API 错误:', error);
        return jsonError('服务器错误', 500, { success: false });
    }
}

export async function GET(): Promise<Response> {
    return jsonOk({
        success: true,
        data: { types: FACE_ANALYSIS_TYPES, disclaimer: FACE_DISCLAIMER },
    });
}
