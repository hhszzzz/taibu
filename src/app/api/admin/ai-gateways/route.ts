/**
 * AI 网关 API（管理员）
 *
 * GET: 网关列表（密钥只返回提示，如 sk-…a1b2）
 * POST: 新建网关
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { parseGatewayInput } from '@/lib/admin/ai-catalog';
import { createGateway, listGateways } from '@/lib/admin/ai-catalog.server';
import { catalogRoute } from '@/lib/admin/ai-catalog-route.server';

export async function GET(request: NextRequest) {
    return catalogRoute(request, '获取网关列表', async () => jsonOk({ gateways: await listGateways() }));
}

export async function POST(request: NextRequest) {
    return catalogRoute(request, '新建网关', async (body) => {
        const parsed = parseGatewayInput(body, { creating: true });
        if ('error' in parsed) return jsonError(parsed.error, 400);
        return jsonOk({ id: await createGateway(parsed.value) }, 201);
    }, { body: true });
}
