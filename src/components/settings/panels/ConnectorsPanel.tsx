/**
 * 连接器：用户自己接入的 MCP 服务，只对自己生效，在开启联网的 Agent 任务中使用。
 *
 * 'use client' 标记说明：
 * - 需要会话状态；列表与编辑交给 McpServerManager
 *
 * 能否添加、能加几个由管理员的扩展策略决定，列表接口随列表返回当前额度。
 */
'use client';

import { useSessionSafe } from '@/components/providers/ClientProviders';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { McpServerManager } from '@/components/settings/mcp/McpServerManager';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { MEMBERSHIP_TIER_LABELS, type ExtensionAllowanceView } from '@/lib/agent/mcp/config';
import type { McpServerListing } from '@/lib/agent/mcp/client';
import { openSettingsCenter } from '@/lib/settings-center';

function AllowanceNotice({ allowance }: { allowance?: ExtensionAllowanceView }) {
  if (!allowance) return null;
  if (!allowance.enabled) {
    return <p className="mcp-notice"><strong>管理员已关闭个人连接器。</strong>已添加的连接器会保留，但暂不会在任务中使用。</p>;
  }
  if (!allowance.tierAllowed || allowance.limit === 0) {
    const tiers = allowance.tiers.map(tier => MEMBERSHIP_TIER_LABELS[tier]);
    return (
      <p className="mcp-notice">
        <strong>{tiers.length ? `个人连接器向 ${tiers.join(' / ')} 会员开放。` : '个人连接器暂未开放。'}</strong>
        已添加的连接器会保留，但暂不会在任务中使用。
        {tiers.length ? <> <button type="button" className="underline underline-offset-2" onClick={() => openSettingsCenter('upgrade')}>查看订阅</button></> : null}
      </p>
    );
  }
  if (allowance.used > allowance.limit) {
    return <p className="mcp-notice">已超出当前会员的数量上限，排序靠后的 {allowance.used - allowance.limit} 个连接器暂不会在任务中使用。</p>;
  }
  return <p className="mcp-notice">连接器只对你自己生效，在开启联网的 Agent 任务中使用。外部服务返回的内容会作为资料交给 Agent，不会改变它的指令。</p>;
}

const canAdd = ({ allowance }: McpServerListing) => !!allowance && allowance.enabled && allowance.tierAllowed && allowance.used < allowance.limit;

export default function ConnectorsPanel() {
  const { user, loading } = useSessionSafe();
  if (loading) {
    return <div className="flex min-h-[240px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
  }
  if (!user) return <SettingsLoginRequired title="请先登录后管理连接器" />;
  return (
    <McpServerManager
      key={user.id}
      scope="user"
      userId={user.id}
      addLabel="添加连接器"
      canAdd={canAdd}
      notice={listing => <AllowanceNotice allowance={listing.allowance} />}
      empty={{ title: '还没有连接器', detail: '接入支持 Streamable HTTP 的 MCP 服务后，Agent 在开启联网的任务中可以调用它的工具。' }}
    />
  );
}
