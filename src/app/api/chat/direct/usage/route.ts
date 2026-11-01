import type { NextRequest } from 'next/server';
import { jsonError, jsonOk, readRequestBytes, requireUserContext } from '@/lib/api-utils';
import { recordDirectUsage } from '@/lib/billing/account.server';
import { AI_RATE_LIMIT_CONFIG, checkRateLimit } from '@/lib/rate-limit';

const RATE_LIMIT_KEY = '/api/chat/direct/usage';
const MAX_COUNT = 100_000_000;

function count(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, MAX_COUNT) : 0;
}

/** What the browser reports after a call it made with the member's own key: recorded at $0 in the usage log. */
export async function POST(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    if (!(await checkRateLimit(auth.user.id, RATE_LIMIT_KEY, AI_RATE_LIMIT_CONFIG)).allowed) {
        return jsonError('请求过于频繁，请稍后再试', 429);
    }
    const bytes = await readRequestBytes(request, 16 * 1024);
    if ('error' in bytes) return jsonError(bytes.error.message, bytes.error.status);
    let body: Record<string, unknown>;
    try {
        body = JSON.parse(bytes.bytes.toString('utf8')) as Record<string, unknown>;
    } catch {
        return jsonError('请求体不是合法 JSON', 400);
    }
    const model = typeof body.model === 'string' ? body.model.trim().slice(0, 200) : '';
    if (!model) return jsonError('缺少模型 ID', 400);
    const usage = {
        input: count(body.input), output: count(body.output),
        cacheRead: count(body.cacheRead), cacheWrite: count(body.cacheWrite),
        ...(count(body.reasoning) ? { reasoning: count(body.reasoning) } : {}),
    };
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
    await recordDirectUsage({
        userId: auth.user.id, model, usage,
        ...(conversationId ? { referenceType: 'conversation', referenceId: conversationId } : {}),
    });
    return jsonOk({ ok: true });
}
