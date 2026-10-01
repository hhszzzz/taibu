import { getCustomProvider } from '@/lib/chat/custom-provider';
import { buildBrowserDirectMessages, streamBrowserDirectProvider } from '@/lib/ai/browser-direct-provider';
import type { BrowserDirectMessage } from '@/lib/ai/browser-direct-provider';

/** 日历问答复用聊天上下文准备和 BYOK 浏览器直连，密钥不发送到本站。 */
export async function requestDailyChat(contextMessage: string): Promise<Response> {
    const provider = getCustomProvider();
    const response = await fetch(provider ? '/api/chat/direct/prepare' : '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: [{ role: 'user', content: contextMessage }],
            stream: false,
        }),
    });

    if (!provider || !response.ok) return response;

    const prepared = await response.json() as {
        systemPrompt: string;
        sanitizedMessages: BrowserDirectMessage[];
    };
    const result = await streamBrowserDirectProvider({
        provider,
        messages: buildBrowserDirectMessages(prepared.systemPrompt, prepared.sanitizedMessages),
    });
    return Response.json({ content: result.content });
}
