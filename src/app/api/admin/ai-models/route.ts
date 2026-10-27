/**
 * AI 模型目录 API（管理员）
 *
 * GET: 全部模型（含停用）与各自的来源
 * POST: 新建模型
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { parseModelInput } from '@/lib/admin/ai-catalog';
import { createModel, listModels } from '@/lib/admin/ai-catalog.server';
import { catalogRoute } from '@/lib/admin/ai-catalog-route.server';

export async function GET(request: NextRequest) {
    return catalogRoute(request, '获取模型列表', async () => jsonOk({ models: await listModels() }));
}

export async function POST(request: NextRequest) {
    return catalogRoute(request, '新建模型', async (body) => {
        const parsed = parseModelInput(body);
        if ('error' in parsed) return jsonError(parsed.error, 400);
        return jsonOk({ id: await createModel(parsed.value) }, 201);
    }, { body: true });
}
