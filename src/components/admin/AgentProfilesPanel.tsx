/**
 * 智能体角色：协作成员与后台子分析按角色工作。内置的体系专家、研究员、复核员写在代码里，只能启停（体系专家是默认角色，不能停用）；
 * 管理员另加的角色可以指定指令、工具、预载技能与模型。
 *
 * 'use client' 标记说明：
 * - 列表请求生命周期、编辑弹窗、删除确认与列表动效
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { useListMotion } from '@/lib/motion/list';
import { AGENT_PROFILE_MODE_LABELS, DEFAULT_AGENT_PROFILE, profileTokenLabel, type AgentProfileInput, type AgentProfileView } from '@/lib/agent/profiles/config';
import { agentProfileClient, type AgentProfileCatalog } from '@/lib/agent/profiles/client';
import { AgentProfileEditor, type ProfileEditorSeed } from './AgentProfileEditor';
import '@/components/settings/mcp/mcp-settings.css';
import './agent-profiles.css';

type ListState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & AgentProfileCatalog);

const NO_PROFILES: AgentProfileView[] = [];

/** 「继承 · 允许 联网、知识库 · 禁止 外部服务」: a role's tools in one line. */
function toolsLine(profile: AgentProfileView) {
  const { inherit, allow, deny } = profile.tools;
  const parts = [
    inherit ? '继承主任务的工具' : null,
    allow.length ? `允许 ${allow.map(profileTokenLabel).join('、')}` : null,
    deny.length ? `禁止 ${deny.map(profileTokenLabel).join('、')}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '不调用工具';
}

export function AgentProfilesPanel() {
  const { showToast } = useToast();
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<ProfileEditorSeed | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AgentProfileView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const profiles = state.status === 'ready' ? state.profiles : NO_PROFILES;
  const listRef = useRef<HTMLUListElement>(null);
  const rows = useListMotion(listRef, profiles, profile => profile.name);

  useEffect(() => {
    const controller = new AbortController();
    agentProfileClient.list(controller.signal).then(
      catalog => setState({ status: 'ready', ...catalog }),
      error => { if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : '读取失败' }); },
    );
    return () => controller.abort();
  }, [reload]);

  const replace = (profile: AgentProfileView) => setState(current => current.status === 'ready'
    ? { ...current, profiles: current.profiles.map(item => item.name === profile.name ? profile : item) } : current);

  const submit = async (input: AgentProfileInput, name: string | null) => {
    if (name) {
      const saved = await agentProfileClient.update(name, input);
      replace(saved);
      showToast('success', `已保存「${saved.displayName}」`);
    } else {
      const created = await agentProfileClient.create(input);
      setState(current => current.status === 'ready' ? { ...current, profiles: [...current.profiles, created] } : current);
      showToast('success', `已添加「${created.displayName}」`);
    }
    setEditor(null);
  };

  const toggle = async (profile: AgentProfileView) => {
    setToggling(profile.name);
    try {
      replace(await agentProfileClient.update(profile.name, { enabled: !profile.enabled }));
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '保存失败');
    } finally {
      setToggling(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await agentProfileClient.remove(pendingDelete.name);
      const removed = pendingDelete.name;
      setState(current => current.status === 'ready' ? { ...current, profiles: current.profiles.filter(item => item.name !== removed) } : current);
      setPendingDelete(null);
      showToast('success', `已删除「${pendingDelete.displayName}」`);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  if (state.status === 'loading') {
    return <div className="flex min-h-[240px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="settings-alert">
        <span className="min-w-0 flex-1">{state.message}</span>
        <Button variant="ghost" size="xs" onClick={() => { setState({ status: 'loading' }); setReload(value => value + 1); }}>重试</Button>
      </div>
    );
  }

  const modelName = (id: string) => state.models.find(model => model.id === id)?.name ?? `${id}（已不可用）`;
  return (
    <div className="flex flex-col gap-4">
      <p className="mcp-notice">
        主任务用 parallel_analysis 派出协作成员、用 background_agent 派出后台子分析时为每位成员选择角色；用户也可以在「设置 → 个性化 → 多模型协作」里给自己的成员选角色。
        成员只能用角色给它的工具，每次调用仍按联网开关与工具范围重新核验。
      </p>
      <div className="mcp-toolbar">
        <p>共 {profiles.length} 个角色</p>
        <Button onClick={() => setEditor({ profile: null })}>
          <Plus size={14} aria-hidden="true" />添加角色
        </Button>
      </div>
      <ul ref={listRef} className="settings-list-card" aria-label="智能体角色">
        {rows.map(({ key, item: profile }) => (
          <li key={key} data-motion-key={key} className="settings-list-item mcp-server">
            <div className="mcp-server-head">
              <div className="settings-list-item-text">
                <strong className="mcp-server-title">
                  {profile.displayName}
                  <span className="skill-name profile-name">{profile.name}</span>
                  {profile.builtin ? <span className="mcp-badge mcp-badge-accent">内置</span> : null}
                  {profile.modes.length === 1 ? <span className="mcp-badge">仅{AGENT_PROFILE_MODE_LABELS[profile.modes[0]]}</span> : null}
                  {profile.enabled ? null : <span className="mcp-badge mcp-badge-muted">已停用</span>}
                </strong>
                {profile.description ? <p className="skill-description">{profile.description}</p> : null}
                <p className="mcp-server-line">
                  {[toolsLine(profile), profile.model ? `模型 ${modelName(profile.model)}` : null,
                    profile.skills.length ? `预载技能 ${profile.skills.join('、')}` : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="mcp-actions">
                <SettingsSwitch label={`启用「${profile.displayName}」`} checked={profile.enabled}
                  disabled={toggling === profile.name || profile.name === DEFAULT_AGENT_PROFILE} onToggle={() => { void toggle(profile); }} />
                {profile.builtin ? null : <>
                  <IconButton label={`编辑「${profile.displayName}」`} size="sm" title="编辑" onClick={() => setEditor({ profile })}>
                    <Pencil size={16} aria-hidden="true" />
                  </IconButton>
                  <IconButton label={`删除「${profile.displayName}」`} tone="danger" size="sm" title="删除"
                    disabled={deleting} onClick={() => setPendingDelete(profile)}>
                    <Trash2 size={16} aria-hidden="true" />
                  </IconButton>
                </>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <AgentProfileEditor seed={editor} catalog={state} onClose={() => setEditor(null)} onSubmit={submit} />
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={confirmDelete}
        loading={deleting}
        variant="danger"
        title="删除角色"
        description={`删除「${pendingDelete?.displayName ?? ''}」后，主任务不能再派出这个角色；用户协作设置里选了它的成员会被拒绝，需要改选角色。`}
        confirmText="删除"
      />
    </div>
  );
}
