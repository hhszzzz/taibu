export const FONT_SCALES = [85, 100, 115, 125] as const;
export type FontScale = typeof FONT_SCALES[number];
export interface ChatPreferences { width: number; fontScale: FontScale; desktopNotifications: boolean; promptTemplates?: AgentPromptTemplate[]; memoryEnabled?: boolean }
// 阅读列宽对齐 claude 实测：会话阅读列 --transcript-width 48rem = 768px（正文列 736px，宽屏恒定）。
// 档位 448–1200 步长 16：448 / 768（默认）/ 1200 同时落在格点上（step 20 时 max 会被浏览器吸附到 1188）。
export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = { width: 768, fontScale: 100, desktopNotifications: false };
export const CHAT_WIDTH_RANGE = { min: 448, max: 1200, step: 16 } as const;
export function normalizeChatPreferences(value: unknown): ChatPreferences {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<ChatPreferences> : {};
    return {
        width: typeof input.width === 'number' && Number.isFinite(input.width) ? Math.max(CHAT_WIDTH_RANGE.min, Math.min(CHAT_WIDTH_RANGE.max, Math.round(input.width))) : DEFAULT_CHAT_PREFERENCES.width,
        fontScale: FONT_SCALES.includes(input.fontScale as FontScale) ? input.fontScale! : 100,
        desktopNotifications: input.desktopNotifications === true,
        ...(input.promptTemplates === undefined ? {} : { promptTemplates: normalizePromptTemplates(input.promptTemplates) }),
        ...(input.memoryEnabled === undefined ? {} : { memoryEnabled: input.memoryEnabled === true }),
    };
}
import { normalizePromptTemplates, type AgentPromptTemplate } from '@/lib/agent/prompt-templates';
