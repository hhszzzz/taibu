'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { requestBrowserJson } from '@/lib/browser-api';
import { registerClientModelNames } from '@/lib/ai/model-name-cache';
import { useAppBootstrap } from '@/lib/hooks/useAppBootstrap';
import { queryKeys } from '@/lib/query/keys';
import type { AIVendor } from '@/types';
import type { MembershipType } from '@/lib/user/membership';

type AvailableModel = {
  id: string;
  name: string;
  vendor: AIVendor;
  supportsReasoning: boolean;
  reasoningEffortFormat?: 'reasoning_object' | 'reasoning_effort' | null;
  isReasoningDefault?: boolean;
  allowed?: boolean;
  /** Lowest membership that can use the model. */
  tier?: 'free' | 'plus' | 'pro' | null;
  blockedReason?: string | null;
  reasoningAllowed?: boolean;
};

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
