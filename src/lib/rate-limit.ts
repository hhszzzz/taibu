/**
 * Distributed rate limiting backed exclusively by Redis (P4).
 *
 * Redis outages preserve fail-open availability without falling back to a
 * per-process counter, so a broken limiter never silently admits more traffic
 * on each web instance.
 */

import { consumeRedisRateLimit } from '@/lib/rate-limit-redis';

export interface RateLimitConfig {
    maxRequests: number;  // 最大请求数
    windowMs: number;     // 时间窗口（毫秒）
}

/** Shared AI admission default; each endpoint retains its own user-scoped bucket. */
export const AI_RATE_LIMIT_CONFIG = {
    maxRequests: 20,
    windowMs: 60_000,
} as const;

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: Date;
}

/**
 * 检查并更新速率限制
 */
export async function checkRateLimit(
    identifier: string,
    endpoint: string,
    config: RateLimitConfig
): Promise<RateLimitResult> {
    if (![identifier, endpoint].every(value => typeof value === 'string' && value.length > 0 && value.length <= 1024)
        || !Number.isInteger(config.maxRequests) || config.maxRequests <= 0 || config.maxRequests > 2_147_483_647
        || !Number.isInteger(config.windowMs) || config.windowMs <= 0 || config.windowMs > 2_147_483_647) {
        throw new Error('Invalid rate limit arguments');
    }
    try {
        return await consumeRedisRateLimit(identifier, endpoint, config);
    } catch {
        console.error('Rate limit check failed: redis unavailable');
        return { allowed: true, remaining: config.maxRequests, resetAt: new Date() };
    }
}

/**
 * 获取客户端 IP。Caddy 注入 x-real-ip 并覆盖任何客户端伪造的同名头；
 * 其它 forwarded 头可被直连客户端伪造，不予信任。
 */
export function getClientIP(request: Request): string {
    const value = request.headers.get('x-real-ip');
    if (!value) return 'unknown';
    return value.split(',')[0].trim() || 'unknown';
}
