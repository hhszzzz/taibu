/**
 * 用户扩展策略：是否允许用户添加自己的连接器（MCP）与技能、哪些会员可以、每档能加几个。
 *
 * 'use client' 标记说明：
 * - 草稿、保存状态与未保存提醒
 */
'use client';

import { useEffect, useState } from 'react';
import { SettingsRow, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsControls';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { fetchAgentExtensionsPolicy, saveAgentExtensionsPolicy } from '@/lib/agent/mcp/client';
import {
  EXTENSION_LIMIT_MAX, MEMBERSHIP_TIERS, MEMBERSHIP_TIER_LABELS, type AgentExtensionsPolicy, type ExtensionGate,
} from '@/lib/agent/mcp/config';
import type { MembershipType } from '@/lib/user/membership';

type Kind = keyof AgentExtensionsPolicy;
type GateDraft = Omit<ExtensionGate, 'limits'> & { limits: Record<MembershipType, string> };
type Draft = Record<Kind, GateDraft>;

const KINDS: Array<{ kind: Kind; title: string; description: string }> = [
  {
    kind: 'connectors', title: '个人连接器',
    description: '用户在「设置 → 扩展 → 连接器」接入自己的 MCP 服务，只对自己生效，在开启联网的任务中使用。关闭或降档后，已添加的保留但不再使用。',
  },
  {
    kind: 'skills', title: '个人技能',
    description: '用户在「设置 → 扩展 → 技能」添加自己的技能，只对自己生效。关闭或降档后，已添加的保留但不再使用。',
  },
];

const draftOf = (policy: AgentExtensionsPolicy): Draft => ({
  connectors: { ...policy.connectors, limits: { free: String(policy.connectors.limits.free), plus: String(policy.connectors.limits.plus), pro: String(policy.connectors.limits.pro) } },
  skills: { ...policy.skills, limits: { free: String(policy.skills.limits.free), plus: String(policy.skills.limits.plus), pro: String(policy.skills.limits.pro) } },
});

function policyOf(draft: Draft): AgentExtensionsPolicy {
  const gate = (kind: Kind, title: string): ExtensionGate => {
    const limits = {} as Record<MembershipType, number>;
    for (const tier of MEMBERSHIP_TIERS) {
      const value = Number(draft[kind].limits[tier].trim());
      if (!draft[kind].limits[tier].trim() || !Number.isInteger(value) || value < 0 || value > EXTENSION_LIMIT_MAX[kind])
        throw new Error(`${title}的 ${MEMBERSHIP_TIER_LABELS[tier]} 上限须为 0–${EXTENSION_LIMIT_MAX[kind]} 的整数`);
      limits[tier] = value;
    }
    return { enabled: draft[kind].enabled, tiers: MEMBERSHIP_TIERS.filter(tier => draft[kind].tiers.includes(tier)), limits };
  };
  return { connectors: gate('connectors', '个人连接器'), skills: gate('skills', '个人技能') };
}

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; saved: Draft; draft: Draft };

export function AgentExtensionsPolicyPanel() {
  const { showToast } = useToast();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const dirty = state.status === 'ready' && JSON.stringify(state.draft) !== JSON.stringify(state.saved);
  useUnsavedSettingsGuard(dirty);

  useEffect(() => {
    const controller = new AbortController();
    fetchAgentExtensionsPolicy(controller.signal).then(
      policy => setState({ status: 'ready', saved: draftOf(policy), draft: draftOf(policy) }),
      error => { if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : '读取扩展策略失败' }); },
    );
    return () => controller.abort();
  }, [reload]);

  if (state.status === 'loading') return <div className="flex min-h-[240px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
  if (state.status === 'error') {
    return (
      <div role="alert" className="settings-alert">
        <span className="min-w-0 flex-1">{state.message}</span>
        <button type="button" onClick={() => { setState({ status: 'loading' }); setReload(value => value + 1); }}>重试</button>
      </div>
    );
  }

  const { draft } = state;
  const change = (kind: Kind, patch: Partial<GateDraft>) => setState(current => current.status === 'ready'
    ? { ...current, draft: { ...current.draft, [kind]: { ...current.draft[kind], ...patch } } } : current);
  const save = async () => {
    let policy: AgentExtensionsPolicy;
    try {
      policy = policyOf(draft);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '填写有误');
      return;
    }
    setSaving(true);
    try {
      const saved = draftOf(await saveAgentExtensionsPolicy(policy));
      setState({ status: 'ready', saved, draft: saved });
      showToast('success', '扩展策略已保存');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '保存扩展策略失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {KINDS.map(({ kind, title, description }) => {
        const gate = draft[kind];
        return (
          <SettingsSection key={kind} title={title} description={description}>
            <SettingsRow label="允许用户添加" control={<SettingsSwitch label={`允许用户添加${title}`} checked={gate.enabled} disabled={saving} onToggle={() => change(kind, { enabled: !gate.enabled })} />} />
            <SettingsRow label="可用会员" description="未选中的会员看不到添加入口。" control={(
              <div className="settings-chips" role="group" aria-label={`${title}的可用会员`}>
                {MEMBERSHIP_TIERS.map(tier => {
                  const on = gate.tiers.includes(tier);
                  return (
                    <button key={tier} type="button" className="settings-chip" aria-pressed={on} disabled={saving || !gate.enabled}
                      onClick={() => change(kind, { tiers: on ? gate.tiers.filter(item => item !== tier) : [...gate.tiers, tier] })}>
                      {MEMBERSHIP_TIER_LABELS[tier]}
                    </button>
                  );
                })}
              </div>
            )} />
            <SettingsRow label="数量上限" description={`每档最多 ${EXTENSION_LIMIT_MAX[kind]} 个；0 表示这一档不能添加。`} control={(
              <div className="flex gap-2">
                {MEMBERSHIP_TIERS.map(tier => (
                  <label key={tier} className="settings-field">
                    <span>{MEMBERSHIP_TIER_LABELS[tier]}</span>
                    <input className="settings-input w-16" inputMode="numeric" aria-label={`${title}的 ${MEMBERSHIP_TIER_LABELS[tier]} 上限`}
                      disabled={saving || !gate.enabled} value={gate.limits[tier]}
                      onChange={event => change(kind, { limits: { ...gate.limits, [tier]: event.target.value } })} />
                  </label>
                ))}
              </div>
            )} />
          </SettingsSection>
        );
      })}
      <div className="settings-actions mt-4">
        <button type="button" className="settings-button settings-button-primary" disabled={!dirty || saving} onClick={() => { void save(); }}>
          {saving ? <SoundWaveLoader variant="inline" /> : null}保存
        </button>
        <button type="button" className="settings-button settings-button-ghost" disabled={!dirty || saving}
          onClick={() => setState(current => current.status === 'ready' ? { ...current, draft: current.saved } : current)}>还原</button>
      </div>
    </div>
  );
}
