/**
 * 关系合盘 API 路由
 */
import { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-utils';
import type { HepanResult } from '@/lib/divination/hepan';
import { saveUserOwnedDivinationRecord } from '@/lib/api/divination-pipeline';

interface HepanRequest {
    action: 'save';
    result?: HepanResult;
    chartId?: string;
}

export async function POST(request: NextRequest) {
    try {
        const body: HepanRequest = await request.json();
        const { action } = body;

        if (action === 'save') {
            return saveUserOwnedDivinationRecord({
                request,
                tag: 'hepan',
                tableName: 'hepan_charts',
                responseKey: 'chartId',
                input: body as unknown as Record<string, unknown>,
                validate: () => (!body.result)
                    ? { error: '请提供合盘结果', status: 400 }
                    : null,
                buildInsertPayload: (_input, userId) => {
                    const result = body.result!;
                    return {
                        user_id: userId,
                        type: result.type,
                        person1_name: result.person1.name,
                        person1_birth: result.person1,
                        person2_name: result.person2.name,
                        person2_birth: result.person2,
                        compatibility_score: result.overallScore,
                        result_data: result,
                    };
                },
            });
        }

        return jsonError('未知操作', 400, { success: false });
    } catch (error) {
        console.error('[hepan] API 错误:', error);
        return jsonError('服务器错误', 500, { success: false });
    }
}
