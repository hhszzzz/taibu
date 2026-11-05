/**
 * 奇门遁甲 API 路由
 *
 * action: 'calculate' — 排盘计算
 * action: 'save'      — 保存记录
 */
import { NextRequest } from 'next/server';
import { DEFAULT_DIVINATION_TIMEZONE, zonedTimeToUtc } from 'taibu-core/timezone-utils';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import {
    calculateQimenBundle,
    toStoredQimenZhiFuJiGong,
    type QimenInput,
    type QimenOutput,
} from '@/lib/divination/qimen';
import { isRouteError, type RouteError } from '@/lib/api-utils';
import { saveUserOwnedDivinationRecord } from '@/lib/api/divination-pipeline';

interface QimenRequest {
    action: 'calculate' | 'save';
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
}

function isIntegerField(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value);
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
