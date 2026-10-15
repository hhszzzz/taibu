export const FONT_SCALES = [85, 100, 115, 125] as const;
export type FontScale = typeof FONT_SCALES[number];
export interface ChatPreferences { width: number; fontScale: FontScale; desktopNotifications: boolean; promptTemplates?: AgentPromptTemplate[]; memoryEnabled?: boolean }
export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = { width: 700, fontScale: 100, desktopNotifications: false };
export function normalizeChatPreferences(value: unknown): ChatPreferences {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<ChatPreferences> : {};
    return {
        width: typeof input.width === 'number' && Number.isFinite(input.width) ? Math.max(560, Math.min(1200, Math.round(input.width))) : 700,
        fontScale: FONT_SCALES.includes(input.fontScale as FontScale) ? input.fontScale! : 100,
        desktopNotifications: input.desktopNotifications === true,
        ...(input.promptTemplates === undefined ? {} : { promptTemplates: normalizePromptTemplates(input.promptTemplates) }),
        ...(input.memoryEnabled === undefined ? {} : { memoryEnabled: input.memoryEnabled === true }),
    };
}
import { normalizePromptTemplates, type AgentPromptTemplate } from '@/lib/agent/prompt-templates';
