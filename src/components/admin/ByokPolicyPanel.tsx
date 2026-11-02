/**
 * 自定义模型策略：是否允许成员把 Key 保存到本站，以及每人的连接数与每个连接的模型数上限。整个入口由功能开关「自定义模型」控制。
 *
 * 'use client' 标记说明：
 * - 草稿、保存状态与未保存提醒
 */
'use client';

import { useEffect, useState } from 'react';
import { SettingsRow, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsControls';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { requestBrowserData } from '@/lib/browser-api';
import { BYOK_CONNECTIONS_LIMIT, BYOK_MODELS_LIMIT, parseByokPolicy, type ByokPolicy } from '@/lib/byok/config';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';

type Draft = { allowServerKeys: boolean; maxConnections: string; maxModelsPerConnection: string };
type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; saved: Draft; draft: Draft };

const draftOf = (policy: ByokPolicy): Draft => ({
  allowServerKeys: policy.allowServerKeys,
  maxConnections: String(policy.maxConnections),
  maxModelsPerConnection: String(policy.maxModelsPerConnection),
});
const sameDraft = (a: Draft, b: Draft) => a.allowServerKeys === b.allowServerKeys
  && a.maxConnections.trim() === b.maxConnections.trim() && a.maxModelsPerConnection.trim() === b.maxModelsPerConnection.trim();

export function ByokPolicyPanel() {
  const { showToast } = useToast();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const dirty = state.status === 'ready' && !sameDraft(state.draft, state.saved);
  useUnsavedSettingsGuard(dirty);

  useEffect(() => {
    const controller = new AbortController();
    requestBrowserData<{ policy: ByokPolicy }>('/api/admin/byok-policy', { signal: controller.signal }, { fallbackMessage: '读取自定义模型策略失败' }).then(
      ({ policy }) => setState({ status: 'ready', saved: draftOf(policy), draft: draftOf(policy) }),
      error => { if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : '读取自定义模型策略失败' }); },
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

  const edit = (patch: Partial<Draft>) => setState(current => current.status === 'ready' ? { ...current, draft: { ...current.draft, ...patch } } : current);
  const save = async () => {
    let policy: ByokPolicy;
    try {
      policy = parseByokPolicy(state.draft);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '策略格式无效');
      return;
    }
    setSaving(true);
    try {
      const saved = (await requestBrowserData<{ policy: ByokPolicy }>('/api/admin/byok-policy', {
        method: 'PUT', body: JSON.stringify({ policy }),
      }, { fallbackMessage: '保存自定义模型策略失败' })).policy;
      setState({ status: 'ready', saved: draftOf(saved), draft: draftOf(saved) });
      showToast('success', '自定义模型策略已保存');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '保存自定义模型策略失败');
    } finally {
      setSaving(false);
    }
  };

  const { draft } = state;
  return (
    <div className="flex flex-col gap-2">
      <SettingsSection title="自定义模型" description="成员接入自己的模型服务与 API Key；这些调用不计费，用量日志只记一条。整个功能可以在「功能开关」里关闭。">
        <SettingsRow label="允许保存到本站" description="成员可以把 Key 加密保存在本站，由服务器代为请求，定时任务也能使用。关闭后已保存的 Key 保留但不再使用，这些连接只能用成员浏览器里的 Key。"
          control={<SettingsSwitch label="允许保存到本站" checked={draft.allowServerKeys} disabled={saving} onToggle={() => edit({ allowServerKeys: !draft.allowServerKeys })} />} />
        <SettingsRow label="每人连接上限" description={`${BYOK_CONNECTIONS_LIMIT.min}–${BYOK_CONNECTIONS_LIMIT.max}；调低后已有的连接保留，但不能再添加。`} control={(
          <Input className="w-20" inputMode="numeric" aria-label="每人连接上限" disabled={saving} value={draft.maxConnections}
            onChange={event => edit({ maxConnections: event.target.value })} />
        )} />
        <SettingsRow label="每个连接的模型上限" description={`${BYOK_MODELS_LIMIT.min}–${BYOK_MODELS_LIMIT.max}；超出上限的连接要先删掉一些模型才能保存修改。`} control={(
          <Input className="w-20" inputMode="numeric" aria-label="每个连接的模型上限" disabled={saving} value={draft.maxModelsPerConnection}
            onChange={event => edit({ maxModelsPerConnection: event.target.value })} />
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
