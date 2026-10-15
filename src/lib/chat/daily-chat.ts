import { getCustomProvider } from '@/lib/chat/custom-provider';
import { buildBrowserDirectMessages, streamBrowserDirectProvider } from '@/lib/ai/browser-direct-provider';
import type { BrowserDirectMessage } from '@/lib/ai/browser-direct-provider';
import type { CalendarAlmanacData } from '@/lib/divination/calendar';
import { FORTUNE_DIMENSIONS, type DailyFortune } from '@/lib/divination/fortune';

export interface DailyChatContextInput {
    date: Date;
    almanac: CalendarAlmanacData;
    question: string;
    /** 用户当前八字命盘在该日的运势；缺省时只基于黄历回答。 */
    personalFortune?: DailyFortune | null;
}

/**
 * 组装日运问答的上下文提示：黄历详情 +（可选）命盘当日运势 + 用户问题。
 * 命盘部分只含流日十神与运势等级，不含姓名、出生时间等个人信息。
 */
export function buildDailyChatContext({ date, almanac, question, personalFortune = null }: DailyChatContextInput): string {
    const dateDisplay = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    const personalSection = personalFortune
        ? `

用户当前八字命盘在该日的运势：
- 流日十神：${personalFortune.tenGod || '未知'}
- 运势等级：${[`综合 ${personalFortune.overall}`, ...FORTUNE_DIMENSIONS.map((item) => `${item.label} ${personalFortune[item.key]}`)].join('，')}`
        : '';

    return `用户正在查询 ${dateDisplay} 的黄历信息和运势。

该日期的黄历详情如下：
- 农历：${almanac.lunarDate}
- 干支：${almanac.ganZhi.year}年 ${almanac.ganZhi.month}月 ${almanac.ganZhi.day}日
- 生肖：年${almanac.shengXiao.year} 月${almanac.shengXiao.month} 日${almanac.shengXiao.day}
- 纳音：${almanac.naYin.year} ${almanac.naYin.month} ${almanac.naYin.day}
- 节气：${almanac.jieQi.current?.name || '无'}
- 宜：${almanac.yi.join('、') || '诸事不宜'}
- 忌：${almanac.ji.join('、') || '无'}
- 吉神：${almanac.jiShen.join('、') || '无'}
- 凶煞：${almanac.xiongSha.join('、') || '无'}
- 冲煞：${almanac.chongSha.chong}
- 空亡：${almanac.kongWang}
- 财神位：${almanac.shenWei.caiShen}
- 喜神位：${almanac.shenWei.xiShen}
- 福神位：${almanac.shenWei.fuShen}
- 值神：${almanac.zhiShen}${personalSection}

用户问题：${question}

请基于以上黄历信息${personalFortune ? '与命盘当日运势' : ''}，用专业但易懂的方式回答用户的问题。`;
}

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
