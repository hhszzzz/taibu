/**
 * 自定义模型提供商 (BYOK) 客户端工具函数
 *
 * 'use client' 隐含：此模块仅在客户端使用
 * 使用 sessionStorage 存储，仅在当前标签页有效，关闭即清除。
 */

import type { CustomProviderConfig } from '@/types';
import { normalizeCustomProviderBaseUrl } from '@/lib/ai/custom-provider-url';

export const CUSTOM_PROVIDER_STORAGE_KEY = 'taibu:custom-provider';
export const LAST_CUSTOM_PROVIDER_STORAGE_KEY = 'taibu:last-custom-provider';
export const CUSTOM_PROVIDER_CHANGED_EVENT = 'taibu:custom-provider:changed';
const LEGACY_CUSTOM_PROVIDER_STORAGE_KEY = 'mingai:custom-provider';
const LEGACY_LAST_CUSTOM_PROVIDER_STORAGE_KEY = 'mingai:last-custom-provider';

/** 解析存储的原始 JSON；不完整或损坏时返回 null。 */
export function parseStoredCustomProvider(stored: string | null): CustomProviderConfig | null {
    if (!stored) return null;
    try {
        const parsed = JSON.parse(stored) as CustomProviderConfig;
        if (parsed.apiUrl && parsed.apiKey && parsed.modelId) {
            return parsed;
        }
        return null;
    } catch {
        return null;
    }
}

function readStoredCustomProvider(key: string): CustomProviderConfig | null {
    if (typeof window === 'undefined') return null;
    return parseStoredCustomProvider(sessionStorage.getItem(key));
}

function writeStoredCustomProvider(key: string, config: CustomProviderConfig): void {
    sessionStorage.setItem(key, JSON.stringify({
        providerKey: config.providerKey,
        providerLabel: config.providerLabel?.trim() || undefined,
        apiUrl: normalizeCustomProviderBaseUrl(config.apiUrl),
        apiKey: config.apiKey.trim(),
        modelId: config.modelId.trim(),
        modelName: config.modelName?.trim() || undefined,
        imageModelId: config.imageModelId?.trim() || undefined,
    }));
}

export function getCustomProvider(): CustomProviderConfig | null {
    if (typeof window !== 'undefined') {
        sessionStorage.removeItem(LEGACY_CUSTOM_PROVIDER_STORAGE_KEY);
    }
    return readStoredCustomProvider(CUSTOM_PROVIDER_STORAGE_KEY);
}

export function getLastCustomProvider(): CustomProviderConfig | null {
    if (typeof window !== 'undefined') {
        sessionStorage.removeItem(LEGACY_LAST_CUSTOM_PROVIDER_STORAGE_KEY);
    }
    return readStoredCustomProvider(LAST_CUSTOM_PROVIDER_STORAGE_KEY);
}

export function setCustomProvider(config: CustomProviderConfig): void {
    if (typeof window === 'undefined') return;
    writeStoredCustomProvider(CUSTOM_PROVIDER_STORAGE_KEY, config);
    writeStoredCustomProvider(LAST_CUSTOM_PROVIDER_STORAGE_KEY, config);
    sessionStorage.removeItem(LEGACY_CUSTOM_PROVIDER_STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_LAST_CUSTOM_PROVIDER_STORAGE_KEY);
    window.dispatchEvent(new Event(CUSTOM_PROVIDER_CHANGED_EVENT));
}

export function clearCustomProvider(): void {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(CUSTOM_PROVIDER_STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_CUSTOM_PROVIDER_STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_LAST_CUSTOM_PROVIDER_STORAGE_KEY);
    window.dispatchEvent(new Event(CUSTOM_PROVIDER_CHANGED_EVENT));
}

export function getCustomProviderDisplayName(
    config: Pick<CustomProviderConfig, 'modelId' | 'modelName'> | null | undefined,
): string | null {
    if (!config) return null;
    return config.modelName?.trim() || config.modelId?.trim() || null;
}
