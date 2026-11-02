/**
 * 定时任务额度：每人最多保留几个定时任务。调整后，已超出的任务在下一分钟由调度器暂停；
 * 任务的个数仍按创建时间保留最早的几个。
 *
 * 'use client' 标记说明：
 * - 草稿、保存状态与未保存提醒
 */
'use client';

import { useEffect, useState } from 'react';
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsControls';
import { Button } from '@/components/ui/Button';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { fetchAgentScheduleLimits, saveAgentScheduleLimits } from '@/lib/agent/schedules/client';
import { Input } from '@/components/ui/Input';
import { AGENT_SCHEDULE_LIMIT_MAX, parseAgentScheduleLimit } from '@/lib/agent/schedules/config';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; saved: string; draft: string };

export function AgentScheduleLimitsPanel() {
  const { showToast } = useToast();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const dirty = state.status === 'ready' && state.draft !== state.saved;
  useUnsavedSettingsGuard(dirty);

  useEffect(() => {
    const controller = new AbortController();
    fetchAgentScheduleLimits(controller.signal).then(
      limits => setState({ status: 'ready', saved: String(limits.limit), draft: String(limits.limit) }),
      error => { if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : '读取定时任务额度失败' }); },
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

  const save = async () => {
    const limit = state.draft.trim() ? parseAgentScheduleLimit(state.draft.trim()) : null;
    if (limit === null) {
      showToast('error', `额度须为 0–${AGENT_SCHEDULE_LIMIT_MAX} 的整数`);
      return;
    }
    setSaving(true);
    try {
      const saved = String((await saveAgentScheduleLimits({ limit })).limit);
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
      <SettingsSection title="定时任务额度" description="每人最多保留几个定时任务；调整后超出的任务会在下一分钟自动暂停，并保留创建最早的几个。">
        <SettingsRow label="数量上限" description={`0 表示不能创建；最大 ${AGENT_SCHEDULE_LIMIT_MAX}。用平台模型的运行按用量计费；Key 保存在本站的自定义模型也能选，不计费。`} control={(
          <Input className="w-20" inputMode="numeric" aria-label="每人定时任务上限" disabled={saving} value={state.draft}
            onChange={event => setState(current => current.status === 'ready' ? { ...current, draft: event.target.value } : current)} />
        )} />
      </SettingsSection>
      <div className="settings-actions mt-4">
        <Button loading={saving} disabled={saving || !dirty} onClick={() => { void save(); }}>保存</Button>
        <Button variant="ghost" disabled={!dirty || saving}
          onClick={() => setState(current => current.status === 'ready' ? { ...current, draft: current.saved } : current)}>还原</Button>
      </div>
    </div>
  );
}
