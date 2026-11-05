/**
 * The member's own models in the browser: the saved connections, which of their models this device can call now, and
 * the requests the settings page makes.
 */
'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { requestBrowserData, requestBrowserJson } from '@/lib/browser-api';
import { matchModelIcon } from '@/lib/ai/lobe-icons';
import { registerClientModelIcons, registerClientModelNames } from '@/lib/ai/model-name-cache';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { queryKeys } from '@/lib/query/keys';
import type { AIReasoningEffort } from '@/types';
import {
  byokEffortLevels,
  usesServerKey,
  type ByokCapability,
  type ByokCatalog,
  type ByokConnectionView,
  type ByokFailure,
  type ByokModelView,
  type ByokProtocol,
} from './config';
import { useDeviceKeys } from './device-keys';
import type { ByokConnectionBody } from './draft';
import type { ByokConnectionProbe, ByokModelTest } from './probe';

export interface OwnModel extends ByokModelView {
  connection: Omit<ByokConnectionView, 'models'>;
  icon: string | null;
  /** The site makes this model's calls: its key is stored there and stored keys are allowed. */
  serverKey: boolean;
  /** This device's key for the connection, used when the calls go from here. */
  deviceKey: string | null;
  /** A call can be made now, through the site or from here. */
  ready: boolean;
}

export function ownModels(catalog: ByokCatalog | null | undefined, keys: Record<string, string>): OwnModel[] {
  if (!catalog) return [];
  return catalog.connections.flatMap(({ models, ...connection }) => {
    const serverKey = usesServerKey(connection, catalog.policy);
    const deviceKey = serverKey ? null : keys[connection.id] ?? null;
    return models.map(model => ({ ...model, connection, icon: matchModelIcon(model.modelId), serverKey, deviceKey, ready: serverKey || !!deviceKey }));
  });
}

// Passed headers replace requestBrowserJson's defaults, so the JSON type is repeated here.
const member = (userId: string) => ({ 'Content-Type': 'application/json', 'X-Expected-User-Id': userId });

async function fetchCatalog(userId: string, signal?: AbortSignal): Promise<ByokCatalog> {
  return requestBrowserData<ByokCatalog>(
    '/api/byok/connections',
    { method: 'GET', signal, headers: member(userId) },
    { fallbackMessage: '自定义模型加载失败' },
  );
}

/** The account's connections; idle while signed out or with the feature closed. */
export function useByokCatalog(userId: string | null | undefined) {
  const toggles = useFeatureToggles({ enabled: !!userId });
  const enabled = !!userId && toggles.isFeatureEnabled('byok');
  const query = useQuery({
    queryKey: queryKeys.byok(userId),
    queryFn: ({ signal }) => fetchCatalog(userId as string, signal),
    enabled,
    staleTime: 5 * 60_000,
  });
  // Messages, the workspace rail and collaboration cards name models by reference.
  useEffect(() => {
    const models = query.data?.connections.flatMap(connection => connection.models.map(model => ({ id: model.ref, name: model.displayName, icon: matchModelIcon(model.modelId) }))) ?? [];
    registerClientModelNames(models);
    registerClientModelIcons(models);
  }, [query.data]);
  return { query, enabled };
}

/** Every own model of the account with what this device can do with it. */
export function useOwnModels(userId: string | null | undefined) {
  const { query, enabled } = useByokCatalog(userId);
  const keys = useDeviceKeys(userId);
  const models = useMemo(() => (enabled ? ownModels(query.data, keys) : []), [enabled, keys, query.data]);
  return {
    models, enabled, loading: enabled && query.isLoading,
    /** The list could not be read: a missing model may still exist. */
    failed: enabled && query.isError,
    catalog: enabled ? query.data ?? null : null,
  };
}

/**
 * An own chat model as the model menus list it beside the platform's. The thinking switch is always offered: an
 * unknown model takes every level, plus the model's own default and an explicit off.
 */
export function ownModelChoice(model: OwnModel) {
  const levels = byokEffortLevels(model.thinkingLevels);
  return {
    id: model.ref,
    name: model.displayName,
    vendor: 'other' as const,
    icon: model.icon,
    supportsReasoning: true,
    supportsVision: model.supportsVision,
    thinkingLevels: levels,
    defaultThinkingLevel: levels.includes(model.defaultEffort as AIReasoningEffort) ? model.defaultEffort as AIReasoningEffort : null,
    contextWindow: model.contextWindow,
    maxTokens: model.maxOutput,
    isReasoningDefault: false,
    own: model,
  };
}

// ─── Settings page requests ───

export async function saveByokConnection(userId: string, id: string | null, body: ByokConnectionBody): Promise<ByokConnectionView> {
  const data = await requestBrowserData<{ connection: ByokConnectionView }>(
    id ? `/api/byok/connections/${id}` : '/api/byok/connections',
    { method: id ? 'PATCH' : 'POST', headers: member(userId), body: JSON.stringify(body) },
    { fallbackMessage: '保存连接失败' },
  );
  if (!data.connection) throw new Error('保存连接失败');
  return data.connection;
}

export async function deleteByokConnection(userId: string, id: string): Promise<void> {
  await requestBrowserData<{ deleted: boolean }>(
    `/api/byok/connections/${id}`,
    { method: 'DELETE', headers: member(userId) },
    { fallbackMessage: '删除连接失败' },
  );
}

export type ByokServerProbe = {
  connectionId?: string | null;
  protocol: ByokProtocol;
  baseUrl: string;
  apiKey?: string | null;
  signal?: AbortSignal;
};

/** A test the site runs, with the key just typed or the one it stores. */
export async function probeOnServer(userId: string, input: ByokServerProbe & { action: 'models' }): Promise<ByokConnectionProbe>;
export async function probeOnServer(userId: string, input: ByokServerProbe & { action: 'chat'; modelId: string; effort: AIReasoningEffort | null }): Promise<ByokModelTest>;
export async function probeOnServer(userId: string, input: ByokServerProbe & { action: 'models' | 'chat'; modelId?: string; effort?: AIReasoningEffort | null }): Promise<ByokConnectionProbe | ByokModelTest> {
  const { signal, ...body } = input;
  const result = await requestBrowserJson<ByokConnectionProbe | ByokModelTest>('/api/byok/probe', {
    method: 'POST', headers: member(userId), body: JSON.stringify(body), signal,
  });
  if (result.error || !result.data) {
    // The request itself was refused (rate limit, invalid input): reported like a failed test.
    const failure: ByokFailure = { text: result.error?.message || '测试失败' };
    return { ok: false, failure };
  }
  return result.data;
}

/** What models.dev knows of these model IDs; empty when it cannot be read. */
export async function fetchByokCapabilities(userId: string, modelIds: string[]): Promise<Record<string, ByokCapability>> {
  if (!modelIds.length) return {};
  const result = await requestBrowserJson<{ models: Record<string, ByokCapability> }>('/api/byok/capabilities', {
    method: 'POST', headers: member(userId), body: JSON.stringify({ modelIds }),
  });
  return result.data?.models ?? {};
}
