/**
 * 结果页 → AI 对话的交接：把预填文本和已保存命盘的结构化 mention 放进 sessionStorage，
 * 再跳到 /chat。用 storage 而不是 URL，避免 @ 芯片在地址栏或输入框里露出 JSON。
 */
import type { Mention } from '@/types/mentions';

type ChatHandoffRouter = { push: (href: string) => void };

export type ChatHandoffPayload = {
  text: string;
  mentions?: Mention[];
};

const CHAT_HANDOFF_STORAGE_KEY = 'taibu:chat-handoff:v1';

function isMention(value: unknown): value is Mention {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<Mention>;
  return typeof item.type === 'string' && typeof item.name === 'string' && item.name.trim().length > 0;
}

export function stashChatHandoff(payload: ChatHandoffPayload) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CHAT_HANDOFF_STORAGE_KEY, JSON.stringify({
      text: payload.text,
      mentions: (payload.mentions ?? []).filter(isMention).slice(0, 10),
    }));
  } catch {
    // 隐私模式或存储已满：仍然跳转，只是不带预填内容。
  }
}

/** 读取并清除，保证同一次交接只应用一次。 */
export function takeChatHandoff(): ChatHandoffPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CHAT_HANDOFF_STORAGE_KEY);
    if (raw === null) return null;
    window.sessionStorage.removeItem(CHAT_HANDOFF_STORAGE_KEY);
    const parsed = JSON.parse(raw) as Partial<ChatHandoffPayload>;
    if (!parsed || typeof parsed.text !== 'string' || !parsed.text.trim()) return null;
    return {
      text: parsed.text,
      mentions: Array.isArray(parsed.mentions) ? parsed.mentions.filter(isMention).slice(0, 10) : [],
    };
  } catch {
    try { window.sessionStorage.removeItem(CHAT_HANDOFF_STORAGE_KEY); } catch { /* optional */ }
    return null;
  }
}

/** 同一结果页的写入只跑一次：「问太卜」可复用自动保存或手动保存中正在进行的写入。 */
export function createSaveOnce() {
  let inFlight: Promise<unknown> | null = null;
  return <T>(task: () => Promise<T>): Promise<T> => {
    if (!inFlight) {
      const current = task();
      inFlight = current;
      const clear = () => { if (inFlight === current) inFlight = null; };
      void current.then(clear, clear);
    }
    return inFlight as Promise<T>;
  };
}

export function openChatWithResult(
  router: ChatHandoffRouter,
  payload: ChatHandoffPayload,
) {
  // 输入框用 `@名称` 渲染芯片；mention 本身通过 mentions 数组交给消息体。
  const tokens = (payload.mentions ?? [])
    .map(mention => `@${mention.name}`)
    .filter(token => !payload.text.includes(token));
  const text = [tokens.join(' '), payload.text].filter(Boolean).join(' ');
  stashChatHandoff({ text, mentions: payload.mentions });
  router.push('/chat');
}
