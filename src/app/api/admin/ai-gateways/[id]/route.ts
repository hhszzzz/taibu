/**
 * 单个 AI 网关 API（管理员）
 *
 * PUT: 修改网关；请求体带 apiKey 时换成新密钥，apiKey 为 null 时清除，不带则保持不变
 * DELETE: 删除没有模型在用的网关
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { parseGatewayInput } from '@/lib/admin/ai-catalog';
import { deleteGateway, updateGateway } from '@/lib/admin/ai-catalog.server';
import { catalogRoute } from '@/lib/admin/ai-catalog-route.server';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
    const { id } = await context.params;
    return catalogRoute(request, '保存网关', async (body) => {
        const parsed = parseGatewayInput(body, { creating: false });
        if ('error' in parsed) return jsonError(parsed.error, 400);
        await updateGateway(id, parsed.value);
        return jsonOk({ success: true });
    }, { body: true });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
    const { id } = await context.params;
    return catalogRoute(request, '删除网关', async () => {
        await deleteGateway(id);
        return jsonOk({ success: true });
    });
}
