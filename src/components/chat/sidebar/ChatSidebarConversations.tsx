/**
 * /chat 在站点侧栏中的「最近」列表：按日期分组（今天 / 昨天 / 更早）并显示
 * Agent 任务标记。其余页面沿用 SidebarConversations 的默认分组。
 *
 * 'use client' 标记说明：
 * - 依赖路由（useSearchParams）与 agent 活动轮询
 */
'use client';

import { useSearchParams } from 'next/navigation';
import { SidebarConversations } from '@/components/layout/SidebarConversations';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { useIsDesktopLayout } from '@/lib/hooks/useIsDesktopLayout';
import { useAgentActivity } from '@/lib/agent/use-agent-activity';

export function ChatSidebarConversations() {
    const { user } = useSessionSafe();
    const searchParams = useSearchParams();
    const desktop = useIsDesktopLayout();
    const markers = useAgentActivity(user?.id ?? null, searchParams.get('id'), desktop);
    return <SidebarConversations grouping="date" markers={markers} />;
}
