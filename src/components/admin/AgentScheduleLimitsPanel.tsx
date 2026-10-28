/**
 * 定时任务额度：每个会员等级最多保留几个定时任务。调整后，已超出的任务在下一分钟
 * 由调度器暂停；任务的个数仍按创建时间保留最早的几个。
 *
 * 'use client' 标记说明：
 * - 草稿、保存状态与未保存提醒
 */
'use client';

import { useEffect, useState } from 'react';
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsControls';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { fetchAgentScheduleLimits, saveAgentScheduleLimits } from '@/lib/agent/schedules/client';
import {
  AGENT_SCHEDULE_LIMIT_MAX, AGENT_SCHEDULE_MEMBERSHIP_LABELS, AGENT_SCHEDULE_MEMBERSHIP_TIERS,
  type AgentScheduleLimits,
} from '@/lib/agent/schedules/config';

type Draft = Record<keyof AgentScheduleLimits, string>;
type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; saved: Draft; draft: Draft };

const draftOf = (limits: AgentScheduleLimits): Draft => ({
  free: String(limits.free), plus: String(limits.plus), pro: String(limits.pro),
});

export function AgentScheduleLimitsPanel() {
  const { showToast } = useToast();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const dirty = state.status === 'ready' && JSON.stringify(state.draft) !== JSON.stringify(state.saved);
  useUnsavedSettingsGuard(dirty);

  useEffect(() => {
    const controller = new AbortController();
    fetchAgentScheduleLimits(controller.signal).then(
      limits => setState({ status: 'ready', saved: draftOf(limits), draft: draftOf(limits) }),
      error => { if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : '读取定时任务额度失败' }); },
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

  const save = async () => {
    const limits = {} as AgentScheduleLimits;
    for (const tier of AGENT_SCHEDULE_MEMBERSHIP_TIERS) {
      const raw = state.draft[tier].trim();
      const value = Number(raw);
      if (!raw || !Number.isInteger(value) || value < 0 || value > AGENT_SCHEDULE_LIMIT_MAX) {
        showToast('error', `${AGENT_SCHEDULE_MEMBERSHIP_LABELS[tier]}的额度须为 0–${AGENT_SCHEDULE_LIMIT_MAX} 的整数`);
        return;
      }
      limits[tier] = value;
    }
    setSaving(true);
    try {
      const saved = draftOf(await saveAgentScheduleLimits(limits));
      setState({ status: 'ready', saved, draft: saved });
      showToast('success', '定时任务额度已保存');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '保存定时任务额度失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <SettingsSection title="定时任务额度" description="每个会员等级最多保留几个定时任务；调整后超出的任务会在下一分钟自动暂停，并保留创建最早的几个。">
        <SettingsRow label="数量上限" description={`0 表示该等级不能创建；最大 ${AGENT_SCHEDULE_LIMIT_MAX}。每次运行照常扣积分。`} control={(
          <div className="flex gap-2">
            {AGENT_SCHEDULE_MEMBERSHIP_TIERS.map(tier => (
              <label key={tier} className="settings-field">
                <span>{AGENT_SCHEDULE_MEMBERSHIP_LABELS[tier]}</span>
                <input className="settings-input w-16" inputMode="numeric" aria-label={`定时任务的 ${AGENT_SCHEDULE_MEMBERSHIP_LABELS[tier]} 上限`}
                  disabled={saving} value={state.draft[tier]}
                  onChange={event => setState(current => current.status === 'ready'
                    ? { ...current, draft: { ...current.draft, [tier]: event.target.value } } : current)} />
              </label>
            ))}
          </div>
        )} />
      </SettingsSection>
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
