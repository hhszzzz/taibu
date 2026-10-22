/**
 * 面相分析 API 路由
 *
 * 提供面相图片分析、历史记录等功能
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
import { createInterpretHandler, type InterpretInput } from '@/lib/api/divination-pipeline';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/jpg']);

interface FaceInterpretInput extends InterpretInput {
    imageBase64: string;
    imageMimeType: string;
    analysisType: string;
    question?: string;
}

const handleAnalyze = createInterpretHandler<FaceInterpretInput>({
    sourceType: 'face',
    tag: 'face',
    allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.face_reading],
    defaultModelId: DEFAULT_VISION_MODEL_ID,
    isVision: true,
    modelAccessOptions: {
        requireVision: true,
        membershipDeniedMessage: '面相分析需要 Plus 会员或以上',
    },
    parseInput: (body) => {
        const b = body as Record<string, unknown>;
        const imageBase64 = b.imageBase64 as string | undefined;
        if (!imageBase64) {
            return { error: '请上传面部照片', status: 400 };
        }
        const raw = typeof b.imageMimeType === 'string' ? b.imageMimeType.trim().toLowerCase() : '';
        if (!raw || !SUPPORTED_IMAGE_MIME_TYPES.has(raw)) {
            return { error: '图片格式不支持', status: 400 };
        }
        return {
            imageBase64,
            imageMimeType: raw,
            analysisType: (b.analysisType as string) || 'full',
            question: b.question as string | undefined,
        };
    },
    buildPrompts: (input) => ({
        systemPrompt: buildFaceSystemPrompt(input.analysisType),
        userPrompt: buildFaceUserPrompt(input.analysisType, input.question),
    }),
    buildVisionOptions: (input) => ({
        imageBase64: input.imageBase64,
        imageMimeType: input.imageMimeType,
    }),
    buildSourceData: (input, modelId, reasoningEnabled) => ({
        analysis_type: input.analysisType,
        question: input.question || null,
        model_id: modelId,
        reasoning: reasoningEnabled,
    }),
    generateTitle: (input) => generateFaceTitle(input.analysisType),
    buildHistoryBinding: (input) => ({
        type: 'face',
        payload: {
            analysis_type: input.analysisType,
        },
    }),
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
