import type { NextResponse } from 'next/server';

import type { FeatureModuleId } from '@/lib/app-settings';
import { isFeatureModuleEnabled, readFeatureModuleStateFresh } from '@/lib/app-settings';
import { jsonError } from '@/lib/api-utils';

export async function ensureFeatureRouteEnabled(
    featureId: FeatureModuleId,
    message = '功能暂未开放',
    status = 403
): Promise<NextResponse | null> {
    return (await isFeatureModuleEnabled(featureId))
        ? null
        : jsonError(message, status);
}

/**
 * Route guard for user-facing features: reads the switch without the permissive
 * cache, and refuses to serve when the state cannot be read (fail closed).
 */
export async function ensureFeatureEnabledFresh(
    featureId: FeatureModuleId,
    message = '功能暂未开放',
): Promise<NextResponse | null> {
    const state = await readFeatureModuleStateFresh(featureId);
    if (state.status === 'enabled') return null;
    if (state.status === 'unavailable') {
        console.error(`[feature-guard] cannot read feature state for ${featureId}:`, state.error);
        return jsonError('功能状态暂时无法确认，请稍后重试', 503, { code: 'FEATURE_STATE_UNAVAILABLE' });
    }
    return jsonError(message, 403, { code: 'FEATURE_DISABLED' });
}
