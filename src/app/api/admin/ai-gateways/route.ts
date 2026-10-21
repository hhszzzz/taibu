/**
 * AI 网关管理 API
 *
 * GET: 获取受管网关列表
 */
import { NextRequest } from 'next/server';
import { requireAdminUser, jsonError, jsonOk } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { DEFAULT_AI_TRANSPORT, isManagedSourceKey } from '@/lib/ai/source-runtime';

function hasEnvVar(envVarName: string): boolean {
    return !!envVarName && !!process.env[envVarName];
}

export async function GET(request: NextRequest) {
    const authResult = await requireAdminUser(request);
    if ('error' in authResult) {
        return jsonError(authResult.error.message, authResult.error.status);
    }

    let gateways: Array<{
        id: string; gateway_key: string; display_name: string; base_url: string;
        api_key_env_var: string; transport: string | null; is_enabled: boolean; notes: string | null;
    }>;
    try {
        gateways = await systemDb().tx((trx) => trx
            .selectFrom('ai_gateways')
            .select(['id', 'gateway_key', 'display_name', 'base_url', 'api_key_env_var', 'transport', 'is_enabled', 'notes'])
            .orderBy('gateway_key', 'asc')
            .execute());
    } catch (error) {
        console.error('[ai-gateways] Failed to fetch gateways:', error);
        return jsonError('获取网关列表失败', 500);
    }

    const managedGateways = gateways
        .filter((gateway: { gateway_key: string | null }) => isManagedSourceKey(gateway.gateway_key))
        .map((gateway: {
            id: string;
            gateway_key: string;
            display_name: string;
            base_url: string;
            api_key_env_var: string;
            transport?: string | null;
            is_enabled: boolean;
            notes: string | null;
        }) => ({
            id: gateway.id,
            gatewayKey: gateway.gateway_key,
            displayName: gateway.display_name,
            baseUrl: gateway.base_url,
            apiKeyEnvVar: gateway.api_key_env_var,
            hasApiKey: hasEnvVar(gateway.api_key_env_var),
            transport: gateway.transport || DEFAULT_AI_TRANSPORT,
            isEnabled: gateway.is_enabled,
            notes: gateway.notes,
        }));

    return jsonOk({ gateways: managedGateways });
}
