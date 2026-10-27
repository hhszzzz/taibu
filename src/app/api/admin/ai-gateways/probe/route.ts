/**
 * POST: 用正在填写的地址与密钥（或已保存的密钥）请求网关的 /v1/models，返回连通情况与模型 ID 列表（管理员）
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { normalizeGatewayBaseUrl } from '@/lib/admin/ai-catalog';
import { probeGateway } from '@/lib/admin/ai-catalog.server';
import { catalogRoute } from '@/lib/admin/ai-catalog-route.server';

export async function POST(request: NextRequest) {
    return catalogRoute(request, '测试网关', async (body) => {
        const value = (body && typeof body === 'object' ? body : {}) as { gatewayId?: unknown; baseUrl?: unknown; apiKey?: unknown };
        const baseUrl = typeof value.baseUrl === 'string' ? normalizeGatewayBaseUrl(value.baseUrl) : null;
        if (!baseUrl) return jsonError('网关地址需要是 http:// 或 https:// 开头的完整地址', 400);
        const gatewayId = typeof value.gatewayId === 'string' && /^[0-9a-f-]{36}$/iu.test(value.gatewayId) ? value.gatewayId : undefined;
        const apiKey = typeof value.apiKey === 'string' && value.apiKey.trim() ? value.apiKey.trim() : undefined;
        return jsonOk(await probeGateway({ gatewayId, baseUrl, apiKey }));
    }, { body: true });
}
