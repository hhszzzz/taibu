/**
 * /chat 与其余页面的站点侧栏共用「最近使用」：按日期分组（今天 / 昨天 / 更早）、显示
 * Agent 任务标记，组头、折叠与滚动都在这里渲染一次。
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
    return <SidebarConversations markers={markers} />;
}
