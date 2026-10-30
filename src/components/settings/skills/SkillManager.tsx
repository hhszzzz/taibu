/**
 * 技能列表：管理员的平台技能与用户自己的技能共用。添加、编辑、启停、删除。
 *
 * 'use client' 标记说明：
 * - 列表请求生命周期、编辑弹窗、删除确认与列表动效
 */
'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { useListMotion } from '@/lib/motion/list';
import { MEMBERSHIP_TIER_LABELS } from '@/lib/agent/mcp/config';
import { formatSkillBytes, type SkillInput, type SkillScope, type SkillView } from '@/lib/agent/skills/config';
import { skillClient, type SkillListing } from '@/lib/agent/skills/client';
import { SkillEditor, type SkillEditorSeed } from './SkillEditor';
import '../mcp/mcp-settings.css';
import './skill-settings.css';

type ListState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & SkillListing);

const NO_SKILLS: SkillView[] = [];

function lineOf(skill: SkillView) {
  const size = skill.bytes + skill.files.reduce((sum, file) => sum + file.bytes, 0);
  return [`v${skill.version}`, skill.files.length ? `${skill.files.length} 个附属文件` : null, formatSkillBytes(size)].filter(Boolean).join(' · ');
}

export function SkillManager({ scope, userId, notice, canAdd = true, empty, onChanged }: {
  scope: SkillScope;
  /** A member's requests are pinned to this account. */
  userId?: string;
  /** Shown above the list, e.g. what the member's allowance permits. */
  notice?: (listing: SkillListing) => ReactNode;
  canAdd?: boolean | ((listing: SkillListing) => boolean);
  empty: { title: string; detail: string };
  onChanged?: () => void;
}) {
  const client = useMemo(() => skillClient(scope, userId), [scope, userId]);
  const { showToast } = useToast();
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<SkillEditorSeed | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkillView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const skills = state.status === 'ready' ? state.skills : NO_SKILLS;
  const listRef = useRef<HTMLUListElement>(null);
  const rows = useListMotion(listRef, skills, skill => skill.id);

  useEffect(() => {
    const controller = new AbortController();
    client.list(controller.signal).then(
      listing => setState({ status: 'ready', ...listing }),
      error => { if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : '读取失败' }); },
    );
    return () => controller.abort();
  }, [client, reload]);

  const replace = (skill: SkillView) => setState(current => current.status === 'ready'
    ? { ...current, skills: current.skills.map(item => item.id === skill.id ? skill : item) } : current);
  const counted = (delta: number) => (listing: SkillListing) => listing.allowance
    ? { ...listing.allowance, used: Math.max(listing.allowance.used + delta, 0) } : undefined;
  const adjustAllowance = (delta: number) => setState(current => current.status === 'ready' && current.allowance
    ? { ...current, allowance: { ...current.allowance, used: Math.max(current.allowance.used + delta, 0) } } : current);

  const submit = async (input: SkillInput) => {
    if (editor?.skill) {
      const saved = await client.update(editor.skill.id, input);
      replace(saved);
      showToast('success', `已保存「${saved.name}」`);
    } else {
      const created = await client.create(input);
      showToast('success', `已添加「${created.name}」`);
      setReload(value => value + 1);
    }
    setEditor(null);
    onChanged?.();
  };

  const toggle = async (skill: SkillView) => {
    setToggling(skill.id);
    try {
      const saved = await client.update(skill.id, { enabled: !skill.enabled });
      replace(saved);
      adjustAllowance(saved.enabled ? 1 : -1);
      onChanged?.();
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
      await client.remove(pendingDelete.id);
      const removed = pendingDelete.id;
      setState(current => current.status === 'ready'
        ? { ...current, skills: current.skills.filter(skill => skill.id !== removed), allowance: counted(pendingDelete.enabled ? -1 : 0)(current) } : current);
      setPendingDelete(null);
      showToast('success', `已删除「${pendingDelete.name}」`);
      onChanged?.();
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

  const addable = typeof canAdd === 'function' ? canAdd(state) : canAdd;
  return (
    <div className="flex flex-col gap-4">
      {notice?.(state)}
      <div className="mcp-toolbar">
        <p>{scope === 'user' && state.allowance && state.allowance.limit > 0 ? `已启用 ${state.allowance.used} / ${state.allowance.limit} 个技能` : `共 ${skills.length} 个技能`}</p>
        <Button disabled={!addable} onClick={() => setEditor({ skill: null })}>
          <Plus size={14} aria-hidden="true" />添加技能
        </Button>
      </div>
      {rows.length ? (
        <ul ref={listRef} className="settings-list-card" aria-label={scope === 'platform' ? '平台技能' : '我的技能'}>
          {rows.map(({ key, item: skill }) => (
            <li key={key} data-motion-key={key} className="settings-list-item mcp-server">
              <div className="mcp-server-head">
                <div className="settings-list-item-text">
                  <strong className="mcp-server-title">
                    <span className="skill-name">{skill.name}</span>
                    {scope === 'platform' ? <span className="mcp-badge">{MEMBERSHIP_TIER_LABELS[skill.requiredTier]}+</span> : null}
                    {skill.manualOnly ? <span className="mcp-badge" title="disable-model-invocation：模型不会自行加载">仅 /skill: 调用</span> : null}
                    {skill.shadowed ? <span className="mcp-badge mcp-badge-muted" title="平台有同名技能，任务中使用平台的那个">被平台同名技能覆盖</span> : null}
                    {skill.enabled ? null : <span className="mcp-badge mcp-badge-muted">已停用</span>}
                  </strong>
                  <p className="skill-description">{skill.description}</p>
                  <p className="mcp-server-line">{lineOf(skill)}</p>
                </div>
                <div className="mcp-actions">
                  <SettingsSwitch label={`启用「${skill.name}」`} checked={skill.enabled} disabled={toggling === skill.id}
                    onToggle={() => { void toggle(skill); }} />
                  <IconButton label={`替换「${skill.name}」`} size="sm" title="重新上传" onClick={() => setEditor({ skill })}>
                    <Pencil size={16} aria-hidden="true" />
                  </IconButton>
                  <IconButton label={`删除「${skill.name}」`} tone="danger" size="sm" title="删除"
                    disabled={deleting} onClick={() => setPendingDelete(skill)}>
                    <Trash2 size={16} aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mcp-empty">
          <p>{empty.title}</p>
          <p>{empty.detail}</p>
        </div>
      )}
      <SkillEditor scope={scope} seed={editor} onClose={() => setEditor(null)} onSubmit={submit} />
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={confirmDelete}
        loading={deleting}
        variant="danger"
        title="删除技能"
        description={`删除「${pendingDelete?.name ?? ''}」后，它的 SKILL.md 与附属文件一并删除，进行中的任务再加载它会被拒绝。`}
        confirmText="删除"
      />
    </div>
  );
}
