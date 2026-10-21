import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { parseBaziCaseProfileInput } from '@/lib/bazi-case-profile';
import { ensureUserOwnsBaziChart, getBaziCaseProfileByChartId, saveBaziCaseProfile } from '@/lib/server/bazi-case-profile';
import { isValidUUID } from '@/lib/validation';

export async function GET(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }

        const chartId = request.nextUrl.searchParams.get('chartId');
        if (!chartId || !isValidUUID(chartId)) {
            return jsonError('chartId 格式不合法', 400);
        }

        const { user } = auth;
        const db = auth.scoped;
        const ownsChart = await ensureUserOwnsBaziChart(db, chartId, user.id);
        if (!ownsChart) {
            return jsonError('未找到对应命盘', 404);
        }

        const profile = await getBaziCaseProfileByChartId(db, chartId, user.id);
        return jsonOk({ profile });
    } catch (error) {
        console.error('[bazi/case-profile][GET] failed:', error);
        return jsonError('获取断事笔记失败', 500);
    }
}

export async function PUT(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }

        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return jsonError('请求体不是合法 JSON', 400);
        }

        let parsed: ReturnType<typeof parseBaziCaseProfileInput>;
        try {
            parsed = parseBaziCaseProfileInput(body);
        } catch (error) {
            return jsonError(error instanceof Error ? error.message : '断事笔记参数无效', 400);
        }

        if (!isValidUUID(parsed.chartId)) {
            return jsonError('chartId 格式不合法', 400);
        }

        const { user } = auth;
        const db = auth.scoped;
        const ownsChart = await ensureUserOwnsBaziChart(db, parsed.chartId, user.id);
        if (!ownsChart) {
            return jsonError('未找到对应命盘', 404);
        }

        const profile = await saveBaziCaseProfile({
            db,
            userId: user.id,
            chartId: parsed.chartId,
            masterReview: parsed.masterReview,
            ownerFeedback: parsed.ownerFeedback,
            events: parsed.events,
        });

        return jsonOk({ profile });
    } catch (error) {
        console.error('[bazi/case-profile][PUT] failed:', error);
        return jsonError('保存断事笔记失败', 500);
    }
}
