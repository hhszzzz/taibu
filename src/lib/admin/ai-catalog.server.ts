import 'server-only';
import { randomUUID } from 'node:crypto';
import { systemDb } from '@/lib/db/context.server';
import { isUniqueViolation } from '@/lib/db/errors';
import { arrayValue } from '@/lib/db/sql-helpers';
import { clearModelCache } from '@/lib/server/ai-config';
import { openGatewayApiKey, sealGatewayApiKey } from '@/lib/ai/gateway-secrets.server';
import { MODEL_REQUEST_USER_AGENT } from '@/lib/ai/providers/ai-sdk-provider';
import { normalizeThinkingLevels } from '@/lib/ai/thinking';
import type { AIUsageType } from '@/types';
import type {
    AdminGateway, AdminGatewayInput, AdminModel, AdminModelInput, CatalogTier, GatewayProbeResult,
} from '@/lib/admin/ai-catalog';

/** A catalog write the admin can correct: shown as is. */
export class CatalogError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}


export async function listGateways(): Promise<AdminGateway[]> {
    const rows = await systemDb().tx(trx => trx.selectFrom('ai_gateways as gateway')
        .select(['gateway.id', 'gateway.gateway_key', 'gateway.display_name', 'gateway.base_url', 'gateway.is_enabled',
            'gateway.api_key_hint'])
        .select(eb => eb.selectFrom('ai_model_gateway_bindings as binding').whereRef('binding.gateway_id', '=', 'gateway.id')
            .select(eb.fn.countAll<string>().as('count')).as('model_count'))
        .orderBy('gateway.created_at', 'asc')
        .execute());
    return rows.map(row => ({
        id: row.id, gatewayKey: row.gateway_key, displayName: row.display_name, baseUrl: row.base_url,
        isEnabled: row.is_enabled, apiKeyHint: row.api_key_hint, modelCount: Number(row.model_count ?? 0),
    }));
}

/** The key columns for a write: a new key is sealed to the row, null clears it, absent keeps it. */
function keyColumns(id: string, apiKey: string | null | undefined) {
    if (apiKey === undefined) return {};
    if (apiKey === null) return { api_key_secret: null, api_key_hint: null };
    const { secret, hint } = sealGatewayApiKey(id, apiKey);
    // node-postgres sends an object parameter as JSON text.
    return { api_key_secret: secret as never, api_key_hint: hint };
}

export async function createGateway(input: AdminGatewayInput): Promise<string> {
    const id = randomUUID();
    try {
        await systemDb().tx(trx => trx.insertInto('ai_gateways').values({
            id, gateway_key: input.gatewayKey, display_name: input.displayName, base_url: input.baseUrl,
            is_enabled: input.isEnabled, ...keyColumns(id, input.apiKey),
        }).execute());
    } catch (error) {
        if (isUniqueViolation(error)) throw new CatalogError('网关标识已存在', 409);
        throw error;
    }
    clearModelCache();
    return id;
}

export async function updateGateway(id: string, input: AdminGatewayInput): Promise<void> {
    let updated;
    try {
        updated = await systemDb().tx(trx => trx.updateTable('ai_gateways').set({
            display_name: input.displayName, base_url: input.baseUrl, is_enabled: input.isEnabled,
            ...keyColumns(id, input.apiKey),
        }).where('id', '=', id).executeTakeFirst());
    } catch (error) {
        if (isUniqueViolation(error)) throw new CatalogError('网关标识已存在', 409);
        throw error;
    }
    if (!updated.numUpdatedRows) throw new CatalogError('网关不存在', 404);
    clearModelCache();
}

export async function deleteGateway(id: string): Promise<void> {
    await systemDb().tx(async trx => {
        const used = await trx.selectFrom('ai_model_gateway_bindings').select(eb => eb.fn.countAll<string>().as('count'))
            .where('gateway_id', '=', id).executeTakeFirstOrThrow();
        if (Number(used.count)) throw new CatalogError(`还有 ${used.count} 个模型经这个网关调用，先从这些模型的来源里移除它`, 409);
        const deleted = await trx.deleteFrom('ai_gateways').where('id', '=', id).executeTakeFirst();
        if (!deleted.numDeletedRows) throw new CatalogError('网关不存在', 404);
    });
    clearModelCache();
}

/**
 * Asks a gateway for its models (`GET /v1/models`) with the key being entered, or the saved one. The address is the
 * administrator's own, so private hosts (a gateway beside the stack) are allowed; nothing of the reply but model IDs
 * is returned.
 */
export async function probeGateway(input: { gatewayId?: string; baseUrl: string; apiKey?: string }): Promise<GatewayProbeResult> {
    let apiKey = input.apiKey;
    if (!apiKey && input.gatewayId) {
        const row = await systemDb().tx(trx => trx.selectFrom('ai_gateways').select('api_key_secret')
            .where('id', '=', input.gatewayId!).executeTakeFirst());
        if (row?.api_key_secret) {
            try { apiKey = openGatewayApiKey(input.gatewayId, row.api_key_secret); }
            catch { return { ok: false, models: [], message: '保存的密钥无法读取，请重新填写' }; }
        }
    }
    if (!apiKey) return { ok: false, models: [], message: '请先填写密钥' };
    const base = input.baseUrl.replace(/\/+$/u, '').replace(/\/(chat\/completions|embeddings|rerank)$/u, '');
    const url = `${/\/v\d+$/u.test(base) ? base : `${base}/v1`}/models`;
    const started = Date.now();
    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': MODEL_REQUEST_USER_AGENT },
            signal: AbortSignal.timeout(10_000), redirect: 'error',
        });
        const latencyMs = Date.now() - started;
        if (response.status === 401 || response.status === 403) return { ok: false, models: [], latencyMs, message: '网关拒绝了这个密钥' };
        if (!response.ok) return { ok: false, models: [], latencyMs, message: `网关返回 ${response.status}` };
        const body = await response.json().catch(() => null) as { data?: Array<{ id?: unknown }> } | null;
        const models = [...new Set((body?.data ?? []).flatMap(item => typeof item?.id === 'string' ? [item.id] : []))].sort().slice(0, 500);
        return { ok: true, models, latencyMs };
    } catch (error) {
        const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
        return { ok: false, models: [], message: timedOut ? '网关 10 秒内没有响应' : '连不上这个地址' };
    }
}

export async function listModels(): Promise<AdminModel[]> {
    const { models, bindings } = await systemDb().tx(async trx => ({
        models: await trx.selectFrom('ai_models').selectAll().orderBy('sort_order', 'asc').orderBy('display_name', 'asc').execute(),
        bindings: await trx.selectFrom('ai_model_gateway_bindings')
            .select(['model_id', 'gateway_id', 'model_id_override', 'is_enabled', 'priority'])
            .orderBy('priority', 'asc').execute(),
    }));
    return models.map(row => ({
        id: row.id,
        modelKey: row.model_key,
        displayName: row.display_name,
        vendor: row.vendor,
        usageType: row.usage_type as AIUsageType,
        creditCost: row.credit_cost ?? 1,
        isEnabled: row.is_enabled !== false,
        sortOrder: row.sort_order ?? 0,
        requiredTier: row.required_tier as CatalogTier,
        supportsVision: row.supports_vision === true,
        isReasoningDefault: row.is_reasoning_default === true,
        thinkingLevels: normalizeThinkingLevels(row.thinking_levels),
        defaultReasoningEffort: (row.default_reasoning_effort ?? null) as AdminModel['defaultReasoningEffort'],
        contextWindow: row.context_window,
        defaultMaxTokens: row.default_max_tokens,
        customParameters: (row.custom_parameters ?? null) as Record<string, unknown> | null,
        sources: bindings.filter(binding => binding.model_id === row.id).map(binding => ({
            gatewayId: binding.gateway_id, modelIdOverride: binding.model_id_override, isEnabled: binding.is_enabled,
        })),
    }));
}

function modelColumns(input: AdminModelInput) {
    return {
        model_key: input.modelKey, display_name: input.displayName, vendor: input.vendor,
        usage_type: input.usageType, credit_cost: input.creditCost, is_enabled: input.isEnabled, sort_order: input.sortOrder,
        required_tier: input.requiredTier, supports_vision: input.supportsVision,
        is_reasoning_default: input.isReasoningDefault,
        thinking_levels: arrayValue(input.thinkingLevels),
        default_reasoning_effort: input.defaultReasoningEffort, context_window: input.contextWindow,
        default_max_tokens: input.defaultMaxTokens,
        custom_parameters: input.customParameters as never,
    };
}

/** Writes a model and replaces its sources in one transaction; the list order is the failover order. */
async function saveModel(id: string | null, input: AdminModelInput): Promise<string> {
    try {
        const saved = await systemDb().tx(async trx => {
            const gatewayIds = input.sources.map(source => source.gatewayId);
            if (gatewayIds.length) {
                const found = await trx.selectFrom('ai_gateways').select('id').where('id', 'in', gatewayIds).execute();
                if (found.length !== gatewayIds.length) throw new CatalogError('来源里有不存在的网关', 400);
            }
            let modelId = id;
            if (modelId) {
                const updated = await trx.updateTable('ai_models').set(modelColumns(input)).where('id', '=', modelId).executeTakeFirst();
                if (!updated.numUpdatedRows) throw new CatalogError('模型不存在', 404);
                await trx.deleteFrom('ai_model_gateway_bindings').where('model_id', '=', modelId).execute();
            } else {
                modelId = (await trx.insertInto('ai_models').values(modelColumns(input)).returning('id').executeTakeFirstOrThrow()).id;
            }
            if (input.sources.length) {
                await trx.insertInto('ai_model_gateway_bindings').values(input.sources.map((source, priority) => ({
                    model_id: modelId!, gateway_id: source.gatewayId, model_id_override: source.modelIdOverride,
                    is_enabled: source.isEnabled, priority,
                }))).execute();
            }
            return modelId;
        });
        clearModelCache();
        return saved;
    } catch (error) {
        if (isUniqueViolation(error)) throw new CatalogError('模型 ID 已存在', 409);
        throw error;
    }
}

export const createModel = (input: AdminModelInput) => saveModel(null, input);
export const updateModel = (id: string, input: AdminModelInput) => saveModel(id, input).then(() => undefined);

export async function setModelEnabled(id: string, enabled: boolean): Promise<void> {
    const updated = await systemDb().tx(trx => trx.updateTable('ai_models').set({ is_enabled: enabled }).where('id', '=', id).executeTakeFirst());
    if (!updated.numUpdatedRows) throw new CatalogError('模型不存在', 404);
    clearModelCache();
}

export async function deleteModel(id: string): Promise<void> {
    await systemDb().tx(async trx => {
        await trx.deleteFrom('ai_model_gateway_bindings').where('model_id', '=', id).execute();
        const deleted = await trx.deleteFrom('ai_models').where('id', '=', id).executeTakeFirst();
        if (!deleted.numDeletedRows) throw new CatalogError('模型不存在', 404);
    });
    clearModelCache();
}
