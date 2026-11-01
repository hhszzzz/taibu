'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { requestBrowserJson } from '@/lib/browser-api';
import { registerClientModelNames } from '@/lib/ai/model-name-cache';
import { useAppBootstrap } from '@/lib/hooks/useAppBootstrap';
import { queryKeys } from '@/lib/query/keys';
import type { AIReasoningEffort, AIVendor } from '@/types';
import type { GeneratedImageSize } from '@/lib/images/generated';

export type AvailableModel = {
  id: string;
  name: string;
  /** 管理员写的一句话简介；没有时不显示。 */
  description?: string | null;
  vendor: AIVendor;
  /** lobehub 图标 ID；为空时按供应商显示。 */
  icon?: string | null;
  supportsReasoning: boolean;
  supportsVision?: boolean;
  /** Levels the model can think at; empty when thinking only switches on and off. */
  thinkingLevels?: AIReasoningEffort[];
  defaultThinkingLevel?: AIReasoningEffort | null;
  contextWindow?: number | null;
  /** 输出上限（token）。 */
  maxTokens?: number | null;
  isReasoningDefault?: boolean;
  /** USD per million tokens; a null cache price charges the input price. */
  pricing?: { input: number; output: number; cacheRead: number | null; cacheWrite: number | null };
};

export type AvailableImageModel = {
  id: string;
  name: string;
  vendor: AIVendor;
  /** 每张图的价格（微美元）。 */
  priceMicros: number;
};

type ImageCatalog = { models: AvailableImageModel[]; sizes: GeneratedImageSize[]; maxCount: number };

async function loadImageModels(): Promise<ImageCatalog> {
  const result = await requestBrowserJson<ImageCatalog>('/api/models?catalog=image', { method: 'GET' });
  if (result.error) throw new Error(result.error.message || '生图模型加载失败');
  return { models: result.data?.models ?? [], sizes: result.data?.sizes ?? [], maxCount: result.data?.maxCount ?? 4 };
}

async function loadAvailableModels() {
  const result = await requestBrowserJson<{ models?: AvailableModel[] }>('/api/models', {
    method: 'GET',
  });

  if (result.error) {
    throw new Error(result.error.message || '模型加载失败');
  }

  return result.data?.models ?? [];
}

export function useAvailableModels(userId?: string | null, options?: { vision?: boolean; enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const vision = options?.vision ?? false;
  const bootstrap = useAppBootstrap({ enabled });
  const effectiveUserId = userId ?? bootstrap.data.viewerSummary?.userId ?? null;

  const query = useQuery({
    queryKey: queryKeys.models(effectiveUserId, { vision }),
    queryFn: loadAvailableModels,
    enabled,
    staleTime: 10 * 60_000,
    select: (models) => (vision ? models.filter((model) => model.supportsVision) : models),
  });

  useEffect(() => {
    if (query.data && query.data.length > 0) {
      registerClientModelNames(query.data);
    }
  }, [query.data]);

  return query;
}

/** 输入框「生图」入口的可用模型；没有可用模型时不显示入口。 */
export function useImageModels(userId?: string | null, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const bootstrap = useAppBootstrap({ enabled });
  const effectiveUserId = userId ?? bootstrap.data.viewerSummary?.userId ?? null;
  const query = useQuery({
    queryKey: [...queryKeys.models(effectiveUserId), 'image'] as const,
    queryFn: loadImageModels,
    enabled,
    staleTime: 10 * 60_000,
  });
  return query;
}
