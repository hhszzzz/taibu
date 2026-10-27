'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { requestBrowserJson } from '@/lib/browser-api';
import { registerClientModelNames } from '@/lib/ai/model-name-cache';
import { useAppBootstrap } from '@/lib/hooks/useAppBootstrap';
import { queryKeys } from '@/lib/query/keys';
import type { AIReasoningEffort, AIVendor } from '@/types';
import type { MembershipType } from '@/lib/user/membership';
import type { GeneratedImageSize } from '@/lib/images/generated';

type AvailableModel = {
  id: string;
  name: string;
  vendor: AIVendor;
  supportsReasoning: boolean;
  /** Levels the model can think at; empty when thinking only switches on and off. */
  thinkingLevels?: AIReasoningEffort[];
  defaultThinkingLevel?: AIReasoningEffort | null;
  contextWindow?: number | null;
  isReasoningDefault?: boolean;
  allowed?: boolean;
  /** Lowest membership that can use the model. */
  tier?: 'free' | 'plus' | 'pro' | null;
  blockedReason?: string | null;
  reasoningAllowed?: boolean;
};

export type AvailableImageModel = {
  id: string;
  name: string;
  vendor: AIVendor;
  /** 每张图扣除的积分。 */
  creditCost: number;
  tier?: 'free' | 'plus' | 'pro' | null;
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

export function useAvailableModels(userId?: string | null, options?: { vision?: boolean; enabled?: boolean; membershipType?: MembershipType | null }) {
  const enabled = options?.enabled ?? true;
  const vision = options?.vision ?? false;
  const bootstrap = useAppBootstrap({ enabled });
  const effectiveUserId = userId ?? bootstrap.data.viewerSummary?.userId ?? null;
  const effectiveMembershipType = options?.membershipType ?? bootstrap.data.membership?.type ?? 'free';

  const query = useQuery({
    queryKey: queryKeys.models(effectiveUserId, {
      vision,
      membershipType: effectiveMembershipType,
    }),
    queryFn: loadAvailableModels,
    enabled,
    staleTime: 10 * 60_000,
    select: (models) => (
      vision
        ? models.filter((model) => model.vendor === 'qwen-vl' || model.vendor === 'gemini-vl')
        : models
    ),
  });

  useEffect(() => {
    if (query.data && query.data.length > 0) {
      registerClientModelNames(query.data);
    }
  }, [query.data]);

  return query;
}

/** 输入框「生图」入口的可用模型；没有可用模型时不显示入口。 */
export function useImageModels(userId?: string | null, options?: { membershipType?: MembershipType | null; enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const bootstrap = useAppBootstrap({ enabled });
  const effectiveUserId = userId ?? bootstrap.data.viewerSummary?.userId ?? null;
  const effectiveMembershipType = options?.membershipType ?? bootstrap.data.membership?.type ?? 'free';
  const query = useQuery({
    queryKey: [...queryKeys.models(effectiveUserId, { membershipType: effectiveMembershipType }), 'image'] as const,
    queryFn: loadImageModels,
    enabled,
    staleTime: 10 * 60_000,
  });
  return query;
}
