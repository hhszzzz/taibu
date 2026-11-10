import type { ChatMessage } from '@/types';

/** 超时提醒是系统生成的一条 user 角色消息，展示、分叉、分享与导出都不能当成用户发言。 */
export function isAskTimeoutReminder(message: Pick<ChatMessage, 'role' | 'metadata'>): boolean {
    return message.role === 'user' && message.metadata?.askTimeout === true;
}
