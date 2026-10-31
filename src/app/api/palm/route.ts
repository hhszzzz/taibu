/**
 * 手相分析 API 路由
 *
 * 提供手相图片分析、历史记录等功能；自定义模型由浏览器带图直连，本站只备提示词与保存结果，不经手照片。
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
import { createDirectInterpretHandlers, createInterpretHandler, type InterpretInput } from '@/lib/api/divination-pipeline';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/jpg']);

interface PalmReadingInput extends InterpretInput {
    analysisType: string;
    handType: HandType;
    question?: string;
}

interface PalmInterpretInput extends PalmReadingInput {
    imageBase64: string;
    imageMimeType: string;
}

const parseReading = (b: Record<string, unknown>): PalmReadingInput => ({
    analysisType: (b.analysisType as string) || 'full',
    handType: ((b.handType as string) || 'left') as HandType,
    question: b.question as string | undefined,
});

/** 平台分析与浏览器直连共用的提示词与保存方式。 */
const reading = {
    sourceType: 'palm',
    tag: 'palm',
    allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.palm_reading],
    buildPrompts: (input: PalmReadingInput) => ({
        systemPrompt: buildPalmSystemPrompt(input.analysisType),
        userPrompt: buildPalmUserPrompt(input.analysisType, input.handType, input.question),
    }),
    buildSourceData: (input: PalmReadingInput, modelId: string, reasoningEnabled: boolean) => ({
        analysis_type: input.analysisType,
        hand_type: input.handType,
        question: input.question || null,
        model_id: modelId,
        reasoning: reasoningEnabled,
    }),
    generateTitle: (input: PalmReadingInput) => generatePalmTitle(input.analysisType, input.handType),
    buildHistoryBinding: (input: PalmReadingInput) => ({
        type: 'palm' as const,
        payload: {
            analysis_type: input.analysisType,
            hand_type: input.handType,
        },
    }),
};

const handleAnalyze = createInterpretHandler<PalmInterpretInput>({
    ...reading,
    defaultModelId: DEFAULT_VISION_MODEL_ID,
    isVision: true,
    modelAccessOptions: {
        requireVision: true,
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
        return { ...parseReading(b), imageBase64, imageMimeType: raw };
    },
    buildVisionOptions: (input) => ({
        imageBase64: input.imageBase64,
        imageMimeType: input.imageMimeType,
    }),
});

const direct = createDirectInterpretHandlers<PalmReadingInput>({
    ...reading,
    parseInput: (body) => parseReading(body as Record<string, unknown>),
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
            case 'direct-prepare':
                return direct.handleDirectPrepare(request, body);
            case 'direct-persist':
                return direct.handleDirectPersist(request, body);
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
