/** Distributed rate limiting backed exclusively by Redis. Redis failure denies admission. */

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
        return { allowed: false, remaining: 0, resetAt: new Date(Date.now() + config.windowMs) };
    }
}

/**
 * 获取客户端 IP。Caddy 注入 x-real-ip 并覆盖任何客户端伪造的同名头；
 * 其它 forwarded 头可被直连客户端伪造，不予信任。
 */
let warnedMissingRealIp = false;

export function getClientIP(request: Request): string {
    const value = request.headers.get('x-real-ip');
    if (!value || !value.trim()) {
        // A proxy that forgets X-Real-IP collapses every caller into one bucket.
        if (process.env.NODE_ENV === 'production' && !warnedMissingRealIp) {
            warnedMissingRealIp = true;
            console.warn('[rate-limit] x-real-ip is missing; set it in the reverse proxy or all clients share one rate-limit bucket');
        }
        return 'unknown';
    }
    return value.split(',')[0].trim() || 'unknown';
}
