/**
 * 技能：用户自己添加的 Agent 技能，只对自己生效。Agent 在相关任务中按描述自动加载，也可以在输入框用 /skill:名称 调用。
 *
 * 'use client' 标记说明：
 * - 需要会话状态；列表与编辑交给 SkillManager
 *
 * 能否添加、能加几个由管理员的扩展策略决定，列表接口随列表返回当前额度。
 */
'use client';

import { useSessionSafe } from '@/components/providers/ClientProviders';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { SkillManager } from '@/components/settings/skills/SkillManager';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { MEMBERSHIP_TIER_LABELS, type ExtensionAllowanceView } from '@/lib/agent/mcp/config';
import type { SkillListing } from '@/lib/agent/skills/client';
import { openSettingsCenter } from '@/lib/settings-center';

function AllowanceNotice({ allowance }: { allowance?: ExtensionAllowanceView }) {
  if (!allowance) return null;
  if (!allowance.enabled) {
    return <p className="mcp-notice"><strong>管理员已关闭个人技能。</strong>已添加的技能会保留，但暂不会在任务中使用。</p>;
  }
  if (!allowance.tierAllowed || allowance.limit === 0) {
    const tiers = allowance.tiers.map(tier => MEMBERSHIP_TIER_LABELS[tier]);
    return (
      <p className="mcp-notice">
        <strong>{tiers.length ? `个人技能向 ${tiers.join(' / ')} 会员开放。` : '个人技能暂未开放。'}</strong>
        已添加的技能会保留，但暂不会在任务中使用。
        {tiers.length ? <> <button type="button" className="underline underline-offset-2" onClick={() => openSettingsCenter('upgrade')}>查看订阅</button></> : null}
      </p>
    );
  }
  if (allowance.limit > 0 && allowance.used >= allowance.limit) {
    return <p className="mcp-notice">已启用 {allowance.used} / {allowance.limit} 个技能；新增会自动停用最早添加的一个。</p>;
  }
  return null;
}

const canAdd = ({ allowance }: SkillListing) => !!allowance && allowance.enabled && allowance.tierAllowed && allowance.limit > 0;

export default function SkillsPanel() {
  const { user, loading } = useSessionSafe();
  if (loading) {
    return <div className="flex min-h-[240px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
  }
  if (!user) return <SettingsLoginRequired title="请先登录后管理技能" />;
  return (
    <SkillManager
      key={user.id}
      scope="user"
      userId={user.id}
      canAdd={canAdd}
      notice={listing => <AllowanceNotice allowance={listing.allowance} />}
      empty={{ title: '还没有技能', detail: '上传一个包含 SKILL.md 的文件夹。' }}
    />
  );
}
