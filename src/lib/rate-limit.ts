/**
 * 基于 Supabase 的分布式速率限制
 * 
 * 支持多实例部署，数据持久化
 */

import { getSystemAdminClient } from '@/lib/api-utils';

// 尝试获取服务端客户端，失败返回null
const getSystemAdminClientSafe = () => {
    try {
        return getSystemAdminClient();
    } catch {
        return null;
    }
};

interface RateLimitConfig {
    maxRequests: number;  // 最大请求数
    windowMs: number;     // 时间窗口（毫秒）
}

/** Shared AI admission default; each endpoint retains its own user-scoped bucket. */
export const AI_RATE_LIMIT_CONFIG = {
    maxRequests: 20,
    windowMs: 60_000,
} as const;

interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: Date;
}

export function resolveRateLimitResetAt(
    rows: Array<{ window_start: string | Date }>,
    windowMs: number
): Date {
    if (rows.length === 0) return new Date();
    let earliest = Infinity;
    for (const row of rows) {
        const ts = new Date(row.window_start).getTime();
        if (!Number.isNaN(ts) && ts < earliest) {
            earliest = ts;
        }
    }
    const base = earliest === Infinity ? Date.now() : earliest;
    return new Date(base + windowMs);
}

/**
 * 检查并更新速率限制
 */
export async function checkRateLimit(
    identifier: string,
    endpoint: string,
    config: RateLimitConfig
): Promise<RateLimitResult> {
    const supabase = getSystemAdminClientSafe();

    // 如果没有 Supabase 配置，回退到内存限制（开发环境）
    if (!supabase) {
        return memoryRateLimit(identifier, endpoint, config);
    }

    const now = new Date();

    try {
        const { data, error } = await supabase.rpc('consume_rate_limit_slot_as_admin', {
            p_identifier: identifier,
            p_endpoint: endpoint,
            p_max_requests: config.maxRequests,
            p_window_ms: config.windowMs,
        });

        if (error) {
            throw error;
        }

        const result = (Array.isArray(data) ? data[0] : data) as {
            allowed?: boolean;
            remaining?: number;
            reset_at?: string;
        } | null;

        if (!result || typeof result.allowed !== 'boolean' || typeof result.remaining !== 'number' || typeof result.reset_at !== 'string') {
            throw new Error('consume_rate_limit_slot_as_admin returned invalid payload');
        }

        return {
            allowed: result.allowed,
            remaining: result.remaining,
            resetAt: new Date(result.reset_at),
        };
    } catch (error) {
        console.error('Rate limit check failed:', error);
        // 出错时允许请求（fail open）
        return { allowed: true, remaining: config.maxRequests, resetAt: now };
    }
}

// 内存速率限制（开发环境备用）
const memoryLimits = new Map<string, { count: number; resetAt: number }>();
const MEMORY_LIMITS_MAX_SIZE = 1024;

function pruneMemoryLimits(now: number): void {
    // Evict expired entries
    for (const [key, record] of memoryLimits.entries()) {
        if (now > record.resetAt) {
            memoryLimits.delete(key);
        }
    }
    // LRU eviction if still over limit
    if (memoryLimits.size > MEMORY_LIMITS_MAX_SIZE) {
        const overflow = memoryLimits.size - MEMORY_LIMITS_MAX_SIZE;
        const keys = memoryLimits.keys();
        for (let i = 0; i < overflow; i++) {
            const next = keys.next();
            if (next.done) break;
            memoryLimits.delete(next.value);
        }
    }
}

function memoryRateLimit(
    identifier: string,
    endpoint: string,
    config: RateLimitConfig
): RateLimitResult {
    const key = `${endpoint}:${identifier}`;
    const now = Date.now();
    pruneMemoryLimits(now);
    const record = memoryLimits.get(key);

    if (!record || now > record.resetAt) {
        memoryLimits.set(key, { count: 1, resetAt: now + config.windowMs });
        return {
            allowed: true,
            remaining: config.maxRequests - 1,
            resetAt: new Date(now + config.windowMs),
        };
    }

    if (record.count >= config.maxRequests) {
        return {
            allowed: false,
            remaining: 0,
            resetAt: new Date(record.resetAt),
        };
    }

    record.count++;
    return {
        allowed: true,
        remaining: config.maxRequests - record.count,
        resetAt: new Date(record.resetAt),
    };
}

/**
 * 获取客户端 IP
 */
export function getClientIP(request: Request): string {
    const candidates = [
        request.headers.get('cf-connecting-ip'),
        request.headers.get('x-vercel-forwarded-for'),
        request.headers.get('x-forwarded-for'),
        request.headers.get('x-real-ip'),
        request.headers.get('x-client-ip'),
    ];
    for (const value of candidates) {
        if (!value) continue;
        return value.split(',')[0].trim();
    }
    return 'unknown';
}
