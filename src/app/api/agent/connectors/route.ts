/**
 * 当前用户在 Agent 任务里可用的连接器（只读）
 *
 * 平台连接器全部列出，个人连接器按扩展策略的数量上限截取；返回名称、用途与归属，供输入框「+」菜单与设置页展示。
 */
import type { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { availableMcpServers } from '@/lib/agent/mcp/session.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    try {
        const servers = await availableMcpServers(auth.user.id, { codeMode: true });
        return jsonOk({
            connectors: servers.map(server => ({
                id: server.id,
                name: server.display_name,
                description: server.description,
                scope: server.owner_id ? 'user' : 'platform',
            })),
        });
    } catch (error) {
        console.error('[agent-connectors] 读取失败:', error instanceof Error ? error.message : error);
        return jsonError('读取连接器失败', 503);
    }
}
