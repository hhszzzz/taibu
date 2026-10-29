/**
 * 大六壬排盘 API 路由
 *
 * action: calculate | save
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { saveUserOwnedDivinationRecord } from '@/lib/api/divination-pipeline';
import { calculateDaliurenBundle, type DaliurenOutput } from '@/lib/divination/daliuren';

interface DaliurenRequest {
    action: 'calculate' | 'save';
    date?: string;
    hour?: number;
    minute?: number;
    timezone?: string;
    question?: string;
    birthYear?: number;
    gender?: 'male' | 'female';
    divinationId?: string;
    resultData?: DaliurenOutput;
}

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
