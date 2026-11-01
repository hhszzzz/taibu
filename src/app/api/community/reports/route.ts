/**
 * 举报 API 路由
 * GET: 管理员获取举报列表
 * POST: 提交举报
 * PUT: 管理员处理举报
 */

import { NextRequest } from 'next/server';
import { COMMUNITY_LIMITS, TargetType, ReportReason, ReportStatus, isReportReason } from '@/lib/community';
import { jsonError, jsonOk, readJsonBody, requireAdminContext, requireUserContext } from '@/lib/api-utils';
import { parsePagination } from '@/lib/pagination';
import { isValidUUID, missingFields } from '@/lib/validation';
import { ensureFeatureEnabledFresh } from '@/lib/feature-gate-utils';
import { checkRateLimit } from '@/lib/rate-limit';

const REPORT_RATE_LIMIT = { maxRequests: 5, windowMs: 60_000 } as const;

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
    const guard = await ensureFeatureEnabledFresh('community', '社区功能当前未启用');
    if (guard) return guard;
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }

        const parsed = await readJsonBody<Record<string, unknown>>(request, 8 * 1024);
        if ('error' in parsed) return jsonError(parsed.error.message, parsed.error.status);
        const body = parsed.body;
        const { targetType, targetId, reason, description } = body as {
            targetType: TargetType;
            targetId: string;
            reason: ReportReason;
            description?: string;
        };

        if (missingFields(body, ['targetType', 'targetId', 'reason']).length > 0) {
            return jsonError('缺少参数', 400);
        }
        if (!['post', 'comment'].includes(targetType)) return jsonError('无效的目标类型', 400);
        if (!isValidUUID(targetId)) return jsonError('目标ID无效', 400);
        if (!isReportReason(reason)) return jsonError('举报原因无效', 400);
        if (typeof description !== 'undefined' && description !== null && typeof description !== 'string') {
            return jsonError('举报说明无效', 400);
        }
        if ((description ?? '').length > COMMUNITY_LIMITS.reportDescription) {
            return jsonError(`举报说明不能超过 ${COMMUNITY_LIMITS.reportDescription} 个字符`, 400);
        }
        if (!(await checkRateLimit(auth.user.id, '/api/community/reports', REPORT_RATE_LIMIT)).allowed) {
            return jsonError('举报过于频繁，请稍后再试', 429);
        }

        let data: unknown;
        try {
            data = await auth.db.rpc('submit_community_report_and_notify', {
                p_target_type: targetType,
                p_target_id: targetId,
                p_reason: reason,
                p_description: description || null,
            });
        } catch (error) {
            const code = (error as { code?: string }).code;
            if (code === 'P0002') return jsonError('目标不存在或已删除', 404);
            if (code === '23505') return jsonError('你已经举报过这条内容', 409);
            if (code === '22023') return jsonError('举报内容无效', 400);
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
