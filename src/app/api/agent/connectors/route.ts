/**
 * 当前会员在 Agent 任务里可用的连接器（只读）
 *
 * 平台连接器按会员等级过滤，个人连接器按扩展策略的数量上限截取；只返回名称与归属，便于输入框「+」菜单展示。
 */
import type { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { getUserCreditInfo } from '@/lib/user/credits';
import { availableMcpServers } from '@/lib/agent/mcp/session.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    try {
        const membership = (await getUserCreditInfo(auth.user.id, {})).membership;
        const servers = await availableMcpServers(auth.user.id, membership, { codeMode: true });
        return jsonOk({
            connectors: servers.map(server => ({
                id: server.id,
                name: server.display_name,
                scope: server.owner_id ? 'user' : 'platform',
            })),
        });
    } catch (error) {
        console.error('[agent-connectors] 读取失败:', error instanceof Error ? error.message : error);
        return jsonError('读取连接器失败', 503);
    }
}
