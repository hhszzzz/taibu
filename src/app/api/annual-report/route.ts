/**
 * 年度报告 API
 */
import { NextRequest, NextResponse } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import {
    generateAnnualReport,
    getCachedAnnualReport,
    getReportSummary,
    type AnnualReportData
} from '@/lib/annual-report';
import { ensureFeatureEnabledFresh } from '@/lib/feature-gate-utils';

interface AnnualReportResponse {
    success: boolean;
    data?: {
        report?: AnnualReportData;
        summary?: {
            hasData: boolean;
            totalAnalyses: number;
            topFeature: string;
        };
    };
    error?: string;
}

// GET - 获取年度报告
export async function GET(request: NextRequest): Promise<NextResponse<AnnualReportResponse>> {
    const guard = await ensureFeatureEnabledFresh('annual-report', '年度报告当前未启用');
    if (guard) return guard as NextResponse<AnnualReportResponse>;
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status, { success: false });
        }
        const { user } = auth;

        const { searchParams } = new URL(request.url);
        const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()));
        const action = searchParams.get('action') || 'report';

        switch (action) {
            case 'summary': {
                const summary = await getReportSummary(user.id, year);
                if (!summary) {
                    return jsonError('获取概要失败', 500, { success: false });
                }
                return jsonOk({ success: true, data: { summary } });
            }

            case 'report': {
                // 先尝试获取缓存
                let report = await getCachedAnnualReport(user.id, year);

                // 如果没有缓存或请求强制刷新，重新生成
                const forceRefresh = searchParams.get('refresh') === 'true';
                if (!report || forceRefresh) {
                    report = await generateAnnualReport(user.id, year);
                }

                if (!report) {
                    return jsonError('生成报告失败', 500, { success: false });
                }

                return jsonOk({ success: true, data: { report } });
            }

            default:
                return jsonError('未知操作', 400, { success: false });
        }
    } catch (error) {
        console.error('[annual-report API] 错误:', error);
        return jsonError('服务器错误', 500, { success: false });
    }
}
