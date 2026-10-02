/** Explicit, independently selected capabilities for API route tests. */

import { createMockAuthContext } from './supabase-mock';
import type { TestContext } from 'node:test';
import type { FeatureModuleState } from '../../lib/app-settings';

/** Auth-only capability: callers must supply the database methods their route uses. */
export function mockRouteUserContext(
    t: Pick<TestContext, 'mock'>,
    client: Record<string, unknown>,
    userId = 'user-1',
) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const apiUtils = require('../../lib/api-utils') as typeof import('../../lib/api-utils');
    /* eslint-enable @typescript-eslint/no-require-imports */
    return t.mock.method(apiUtils, 'requireUserContext', async () => createMockAuthContext(client, userId));
}

/** Fail even when a lower-level adapter catches an unexpected fetch failure. */
export function blockRouteNetwork(t: Pick<TestContext, 'mock' | 'after'>) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('Unexpected network request in route test');
    });
    t.after(() => {
        if (fetchMock.mock.callCount() > 0) throw new Error('Route test attempted network access');
    });
}

/** Temporarily replaces console.error with a capturing stub. */
export function captureConsoleErrors() {
    const original = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]) => {
        errors.push(args.map(String).join(' '));
    };
    return {
        errors,
        restore: () => {
            console.error = original;
        },
    };
}

/** Standard env vars needed by most route tests. */
export function ensureRouteTestEnv() {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';
    process.env.NEWAPI_API_KEY = process.env.NEWAPI_API_KEY || 'test-key';
    process.env.NEWAPI_BASE_URL = process.env.NEWAPI_BASE_URL || 'https://newapi.example';
    process.env.MINGAI_FALLBACK_MODELS_JSON = process.env.MINGAI_FALLBACK_MODELS_JSON || JSON.stringify([
        {
            id: 'deepseek-v3.2',
            name: 'DeepSeek V3.2',
            vendor: 'deepseek',
            usageType: 'chat',
            supportsReasoning: false,
        },
    ]);
}

/**
 * Keeps route tests explicit about the global AI capability state. Production
 * handlers still execute the real fail-closed app-settings read.
 */
export function mockAIFeatureState(
    t: Pick<TestContext, 'after'>,
    state: FeatureModuleState = { status: 'enabled' },
) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const appSettings = require('../../lib/app-settings') as typeof import('../../lib/app-settings');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const original = appSettings.readFeatureModuleStateFresh;
    appSettings.readFeatureModuleStateFresh = async () => state;
    t.after(() => {
        appSettings.readFeatureModuleStateFresh = original;
    });
}

/** Explicit limiter seam for AI route fixtures; never contacts the limiter backend. */
export function mockAIRateLimit(
    t: Pick<TestContext, 'after'>,
    implementation?: typeof import('../../lib/rate-limit').checkRateLimit,
) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const rateLimit = require('../../lib/rate-limit') as typeof import('../../lib/rate-limit');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const original = rateLimit.checkRateLimit;
    rateLimit.checkRateLimit = implementation ?? (async (_identifier, _endpoint, config) => ({
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt: new Date(Date.now() + config.windowMs),
    }));
    t.after(() => { rateLimit.checkRateLimit = original; });
}
