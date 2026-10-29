/**
 * MBTI 性格测试 API 路由
 *
 * 提供测试结果保存功能
 */
import { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-utils';
import type { MBTIType } from '@/lib/divination/mbti';
import { saveUserOwnedDivinationRecord } from '@/lib/api/divination-pipeline';

interface MBTIRequest {
    action: 'save';
    type: MBTIType;
    scores: Record<string, number>;
    percentages: {
        EI: { E: number; I: number };
        SN: { S: number; N: number };
        TF: { T: number; F: number };
        JP: { J: number; P: number };
    };
    readingId?: string;
}

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

        return jsonError('未知操作', 400, { success: false });
    } catch (error) {
        console.error('[mbti] API 错误:', error);
        return jsonError('服务器错误', 500, { success: false });
    }
}
