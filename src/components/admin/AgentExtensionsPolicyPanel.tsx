/**
 * 用户扩展策略：是否允许用户添加自己的连接器（MCP）与技能、每人能加几个。
 *
 * 'use client' 标记说明：
 * - 草稿、保存状态与未保存提醒
 */
'use client';

import { useEffect, useState } from 'react';
import { SettingsRow, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsControls';
import { Button } from '@/components/ui/Button';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { fetchAgentExtensionsPolicy, saveAgentExtensionsPolicy } from '@/lib/agent/extensions/client';
import { EXTENSION_LIMIT_MAX, type AgentExtensionsPolicy } from '@/lib/agent/extensions/config';
import { Input } from '@/components/ui/Input';

type Kind = keyof AgentExtensionsPolicy;
type GateDraft = { enabled: boolean; limit: string };
type Draft = Record<Kind, GateDraft>;

const KINDS: Array<{ kind: Kind; title: string; description: string }> = [
  {
    kind: 'connectors', title: '个人连接器',
    description: '用户在「设置 → 扩展 → 连接器」接入自己的 MCP 服务，只对自己生效，在开启联网的任务中使用。关闭或调低上限后，已添加的保留但超出部分不再使用。',
  },
  {
    kind: 'skills', title: '个人技能',
    description: '用户在「设置 → 扩展 → 技能」添加自己的技能，只对自己生效。关闭或调低上限后，已添加的保留但超出部分不再使用。',
  },
];

const draftOf = (policy: AgentExtensionsPolicy): Draft => ({
  connectors: { enabled: policy.connectors.enabled, limit: String(policy.connectors.limit) },
  skills: { enabled: policy.skills.enabled, limit: String(policy.skills.limit) },
});

function policyOf(draft: Draft): AgentExtensionsPolicy {
  const gate = (kind: Kind, title: string) => {
    const raw = draft[kind].limit.trim();
    const limit = Number(raw);
    if (!raw || !Number.isInteger(limit) || limit < 0 || limit > EXTENSION_LIMIT_MAX[kind]) {
      throw new Error(`${title}的上限须为 0–${EXTENSION_LIMIT_MAX[kind]} 的整数`);
    }
    return { enabled: draft[kind].enabled, limit };
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
        <Button variant="ghost" size="xs" onClick={() => { setState({ status: 'loading' }); setReload(value => value + 1); }}>重试</Button>
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
            <SettingsRow label="数量上限" description={`每人最多 ${EXTENSION_LIMIT_MAX[kind]} 个；0 表示不能添加。`} control={(
              <Input className="w-20" inputMode="numeric" aria-label={`${title}的数量上限`} disabled={saving || !gate.enabled} value={gate.limit}
                onChange={event => change(kind, { limit: event.target.value })} />
            )} />
          </SettingsSection>
        );
      })}
      <div className="settings-actions mt-4">
        <Button loading={saving} disabled={saving || !dirty} onClick={() => { void save(); }}>保存</Button>
        <Button variant="ghost" disabled={!dirty || saving}
          onClick={() => setState(current => current.status === 'ready' ? { ...current, draft: current.saved } : current)}>还原</Button>
      </div>
    </div>
  );
}
