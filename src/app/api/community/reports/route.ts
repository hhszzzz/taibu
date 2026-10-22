/**
 * 举报 API 路由
 * GET: 管理员获取举报列表
 * POST: 提交举报
 * PUT: 管理员处理举报
 */

import { NextRequest } from 'next/server';
import { TargetType, ReportReason, ReportStatus } from '@/lib/community';
import { jsonError, jsonOk, requireAdminContext, requireUserContext } from '@/lib/api-utils';
import { parsePagination } from '@/lib/pagination';
import { missingFields } from '@/lib/validation';

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAdminContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') as ReportStatus | null;
        const { from, to } = parsePagination(searchParams, { defaultPageSize: 20 });

        const result = await auth.db.tx(async (trx) => {
            const filtered = () => {
                let query = trx.selectFrom('community_reports');
                if (status) query = query.where('status', '=', status);
                return query;
            };
            const totalRow = await filtered().select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirst();
            const rows = await filtered().selectAll().orderBy('created_at', 'desc').offset(from).limit(to - from + 1).execute();
            return { rows, total: Number(totalRow?.count ?? 0) };
        });

        return jsonOk({
            reports: result.rows,
            total: result.total,
        });
    } catch (error) {
        console.error('获取举报列表失败:', error);
        return jsonError('获取举报列表失败', 500);
    }
}

export async function POST(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }

        const body = await request.json();
        const { targetType, targetId, reason, description } = body as {
            targetType: TargetType;
            targetId: string;
            reason: ReportReason;
            description?: string;
        };

        if (missingFields(body, ['targetType', 'targetId', 'reason']).length > 0) {
            return jsonError('缺少参数', 400);
        }

        let data: unknown;
        try {
            data = await auth.db.rpc('submit_community_report_and_notify' as never, {
                p_target_type: targetType,
                p_target_id: targetId,
                p_reason: reason,
                p_description: description || null,
            } as never);
        } catch (error) {
            console.error('提交举报失败:', error);
            return jsonError('提交举报失败', 500);
        }

        const result = (Array.isArray(data) ? data[0] : data) as { status?: string; report?: unknown } | null;
        if (result?.status !== 'ok' || !result.report) {
            console.error('提交举报失败: unexpected rpc response', result);
            return jsonError('提交举报失败', 500);
        }

        return jsonOk(result.report);
    } catch (error) {
        console.error('提交举报失败:', error);
        return jsonError('提交举报失败', 500);
    }
}

export async function PUT(request: NextRequest) {
    try {
        const auth = await requireAdminContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }
        const { user } = auth;

        const body = await request.json();
        const { reportId, status, notes } = body as {
            reportId: string;
            status: 'resolved' | 'dismissed';
            notes?: string;
        };

        if (missingFields(body, ['reportId', 'status']).length > 0) {
            return jsonError('缺少参数', 400);
        }

        try {
            await auth.db.tx((trx) => trx
                .updateTable('community_reports')
                .set({
                    status,
                    reviewed_by: user.id,
                    reviewed_at: new Date().toISOString(),
                    review_notes: notes || null,
                })
                .where('id', '=', reportId)
                .execute());
        } catch (error) {
            console.error('处理举报失败:', error);
            return jsonError('处理举报失败', 500);
        }

        return jsonOk({ success: true });
    } catch (error) {
        console.error('处理举报失败:', error);
        return jsonError('处理举报失败', 500);
    }
}
