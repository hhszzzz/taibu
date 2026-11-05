/**
 * 导出记录 API 路由
 * GET: 导出所有数据
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUserContext, jsonError } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
        const { user } = auth;

        // 获取所有记录和小记
        const [records, notes] = await Promise.all([
            auth.db.tx((trx) => trx.selectFrom('ming_records').selectAll().where('user_id', '=', user.id).execute()),
            auth.db.tx((trx) => trx.selectFrom('ming_notes').selectAll().where('user_id', '=', user.id).execute()),
        ]);

        const now = new Date();
        const exportData = {
            version: '1.0',
            exportedAt: now.toISOString(),
            records,
            notes,
        };

        const json = JSON.stringify(exportData, null, 2);
        const filename = `mingai-records-${now.toISOString().split('T')[0]}.json`;

        return new NextResponse(json, {
            headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    } catch (error) {
        console.error('导出数据失败:', error);
        return jsonError('导出数据失败', 500);
    }
}
