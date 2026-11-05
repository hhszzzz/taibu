import 'server-only';
import { agentCredentialKey } from '@/lib/agent/credentials.server';
import { byokKeyHint } from '@/lib/byok/config';
import { deriveSecretKey, isSealedSecret, openSecret, sealSecret } from '@/lib/crypto/secret-box.server';
import { applySourceToModel, getOrderedModelSources } from '@/lib/ai/source-runtime';
import type { AIModelConfig, AISealedSecret } from '@/types';

/**
 * A gateway's API key is sealed under its own key and bound to the gateway row: copied to another gateway, it does
 * not open. Only the ciphertext travels in model configurations (and their shared cache); it is opened per request.
 */
const GATEWAY_SECRET_INFO = 'taibu-gateway-secrets:v1';

function gatewaySecretKey() {
    return deriveSecretKey(agentCredentialKey(), GATEWAY_SECRET_INFO);
}

function additionalData(gatewayId: string) {
    return `taibu-gateway:v1:${gatewayId}:api_key`;
}

/** What the admin sees of a saved key: enough to tell two keys apart, never enough to use one. */
export function sealGatewayApiKey(gatewayId: string, apiKey: string): { secret: AISealedSecret; hint: string } {
    return { secret: sealSecret(gatewaySecretKey(), apiKey, additionalData(gatewayId)), hint: byokKeyHint(apiKey) };
}

/** Throws AI_GATEWAY_KEY_INVALID when the value was tampered with, sealed for another gateway or under another master key. */
export function openGatewayApiKey(gatewayId: string, secret: unknown): string {
    if (!isSealedSecret(secret)) throw new Error('AI_GATEWAY_KEY_INVALID');
    try {
        return openSecret(gatewaySecretKey(), secret, additionalData(gatewayId));
    } catch {
        throw new Error('AI_GATEWAY_KEY_INVALID');
    }
}

/** The plaintext key of a model's current source; undefined when its gateway has none saved. */
export function resolveSourceApiKey(source: { gatewayId?: string; apiKeySecret?: AISealedSecret | null }): string | undefined {
    if (!source.gatewayId || !source.apiKeySecret) return undefined;
    return openGatewayApiKey(source.gatewayId, source.apiKeySecret);
}

/** For callers that move on to the next source: a key that does not open counts as none, with a warning. */
export function sourceApiKeyOrNone(source: { gatewayId?: string; apiKeySecret?: AISealedSecret | null; sourceKey?: string }): string | undefined {
    try {
        return resolveSourceApiKey(source);
    } catch {
        console.warn(`[ai] the saved key of gateway ${source.sourceKey ?? source.gatewayId} does not open`);
        return undefined;
    }
}

/**
 * A model's callable sources in failover order, each applied to the model and with its key opened; a source whose key
 * does not open is skipped.
 */
export function openModelSources(model: AIModelConfig): Array<{ config: AIModelConfig; apiKey: string }> {
    const opened: Array<{ config: AIModelConfig; apiKey: string }> = [];
    for (const source of getOrderedModelSources(model)) {
        const config = applySourceToModel(model, source);
        const apiKey = sourceApiKeyOrNone(config);
        if (apiKey && config.apiUrl) opened.push({ config, apiKey });
    }
    return opened;
}
