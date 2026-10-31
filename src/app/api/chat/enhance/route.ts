import { type NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';
import { getBalanceGuardResponse } from '@/lib/api/balance-guard';
import { getDefaultModelConfigAsync, getModelConfigAsync } from '@/lib/server/ai-config';
import { isModelOffered } from '@/lib/ai/ai-access';
import { usageBiller } from '@/lib/billing/account.server';
import { callAI } from '@/lib/ai/ai';
import { PROMPT_ENHANCEMENT_MAX_LENGTH, PROMPT_ENHANCEMENT_MAX_TOKENS, PROMPT_ENHANCEMENT_SYSTEM_PROMPT } from '@/lib/chat/prompt-enhancement';
// 平台模型润色：每日 5 次、按用量计费；自定义模型由浏览器直连，不经过这里。
export async function POST(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const guard = await getGlobalAIFeatureGuardResponse();
    if (guard) return guard;
    let body: { text?: string; model?: string };
    try { body = await request.json(); } catch { return jsonError('请求体无效', 400); }
    if (typeof body?.text !== 'string' || !body.text.trim() || body.text.length > PROMPT_ENHANCEMENT_MAX_LENGTH) return jsonError(`润色内容须为 1–${PROMPT_ENHANCEMENT_MAX_LENGTH} 个字符`, 400);
    const config = typeof body.model === 'string' ? await getModelConfigAsync(body.model) : await getDefaultModelConfigAsync('chat');
    if (!config || !isModelOffered(config)) return jsonError('当前模型不可用', 403);
    const balanceGuard = await getBalanceGuardResponse(auth.user.id, config.pricing, auth.db);
    if (balanceGuard) return balanceGuard;
    let quotaExceeded = false;
    try {
        const text = await callAI([{ role: 'user', content: body.text }], 'general', config.id, '', { maxTokens: PROMPT_ENHANCEMENT_MAX_TOKENS, reasoning: false,
            systemPromptOverride: PROMPT_ENHANCEMENT_SYSTEM_PROMPT,
            onUsage: usageBiller(auth.user.id, 'enhance'),
            beforeModelAttempt: async () => {
                let granted: boolean;
                try {
                    granted = await auth.db.rpc('claim_prompt_enhancement', {});
                } catch (error) {
                    console.error('润色额度校验失败:', error);
                    throw new Error('润色额度暂不可用');
                }
                if (!granted) { quotaExceeded = true; throw new Error('今天的 5 次润色调用已用完'); }
            },
        });
        if (!text.trim()) return jsonError('模型没有返回润色结果', 502);
        return jsonOk({ text: text.trim() });
    } catch { return jsonError(quotaExceeded ? '今天的 5 次润色调用已用完' : '润色失败，请重试', quotaExceeded ? 429 : 502); }
}
