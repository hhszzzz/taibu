/**
 * 导入记录 API 路由
 * POST: 导入数据（覆盖模式）
 */

import { NextRequest } from 'next/server';
import { requireUserContext, jsonError, jsonOk } from '@/lib/api-utils';

const MAX_IMPORT_RECORDS = 500;

type ImportRpcResult = {
    recordsImported?: unknown;
    notesImported?: unknown;
};

function parseImportRpcResult(value: unknown): { recordsImported: number; notesImported: number } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const result = value as ImportRpcResult;
    const recordsImported = Number(result.recordsImported ?? NaN);
    const notesImported = Number(result.notesImported ?? NaN);

    if (!Number.isFinite(recordsImported) || !Number.isFinite(notesImported)) {
        return null;
    }

    return {
        recordsImported,
        notesImported,
    };
}

export async function POST(request: NextRequest) {
    try {
        const auth = await requireUserContext(request);
        if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
        const { user } = auth;

        const data = await request.json();

        // 验证数据格式
        if (!data.version || !Array.isArray(data.records) || !Array.isArray(data.notes)) {
            return jsonError('导入数据格式无效', 400);
        }

        if (data.records.length > MAX_IMPORT_RECORDS) {
            return jsonError(`记录数量超过上限（最多 ${MAX_IMPORT_RECORDS} 条）`, 400);
        }
        if (data.notes.length > MAX_IMPORT_RECORDS) {
            return jsonError(`小记数量超过上限（最多 ${MAX_IMPORT_RECORDS} 条）`, 400);
        }

        let importResult: unknown;
        try {
            importResult = await auth.scoped.rpc('import_ming_records_and_notes', {
                p_records: data.records,
                p_notes: data.notes,
            });
        } catch (error) {
            console.error('导入事务失败:', error, { userId: user.id });
            return jsonError('导入数据失败', 500);
        }

        const parsedResult = parseImportRpcResult(importResult);
        if (!parsedResult) {
            console.error('导入事务返回值无效:', importResult, { userId: user.id });
            return jsonError('导入数据失败', 500);
        }

        return jsonOk({
            message: `成功导入 ${parsedResult.recordsImported} 条记录和 ${parsedResult.notesImported} 条小记`,
            recordsImported: parsedResult.recordsImported,
            notesImported: parsedResult.notesImported,
        });
    } catch (error) {
        console.error('导入数据失败:', error);
        return jsonError('导入数据失败', 500);
    }
}
