/**
 * 单个 AI 模型 API（管理员）
 *
 * PUT: 保存整个模型（含来源顺序）
 * PATCH: 只切换启用状态 { isEnabled }
 * DELETE: 删除模型及其来源
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { parseModelInput } from '@/lib/admin/ai-catalog';
import { deleteModel, setModelEnabled, updateModel } from '@/lib/admin/ai-catalog.server';
import { catalogRoute } from '@/lib/admin/ai-catalog-route.server';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
    const { id } = await context.params;
    return catalogRoute(request, '保存模型', async (body) => {
        const parsed = parseModelInput(body);
        if ('error' in parsed) return jsonError(parsed.error, 400);
        await updateModel(id, parsed.value);
        return jsonOk({ success: true });
    }, { body: true });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
    const { id } = await context.params;
    return catalogRoute(request, '更新模型', async (body) => {
        const enabled = (body as { isEnabled?: unknown } | null)?.isEnabled;
        if (typeof enabled !== 'boolean') return jsonError('只支持修改 isEnabled', 400);
        await setModelEnabled(id, enabled);
        return jsonOk({ success: true });
    }, { body: true });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
    const { id } = await context.params;
    return catalogRoute(request, '删除模型', async () => {
        await deleteModel(id);
        return jsonOk({ success: true });
    });
}
