'use client';
// 需要读写协作预设与模型列表

import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Select } from '@/components/ui/Select';
import { useAvailableModels, type AvailableModel } from '@/lib/hooks/useAvailableModels';
import { useCollaborationPreset, writeCollaborationPreset } from '@/lib/chat/collaboration-preset';
import type { AgentCollaborator } from '@/lib/chat/model-settings';
import { DEFAULT_AGENT_PROFILE } from '@/lib/agent/profiles/config';
import { fetchProfileOptions } from '@/lib/agent/profiles/client';
import { queryKeys } from '@/lib/query/keys';
import type { AgentProfileOption } from '@/lib/agent/profiles/config';
import type { MembershipType } from '@/lib/user/membership';
import { BetaBadge } from '@/components/ui/BetaBadge';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

const EFFORT_LABELS: ReadonlyArray<readonly [NonNullable<AgentCollaborator['reasoningEffort']>, string]> = [
    ['minimal', '最低'], ['low', '低'], ['medium', '中'], ['high', '高'], ['xhigh', '超高'], ['max', '最高'],
];

const MAX_MEMBERS = 4;

/**
 * 多模型协作成员模板（claude 把协作成员配置收进设置；模型菜单只保留勾选开关）。
 * 模板保存在本机（按用户隔离）：每个对话默认不协作，在模型菜单勾选某个模型时才套用它在这里的名称、角色、努力程度与分工。
 * 角色由管理员提供，默认体系专家；角色指定了模型时，会员可用就由它代替这里的模型。
 */
export function CollaborationSettings({ userId, membershipType }: { userId: string; membershipType?: MembershipType }) {
    const preset = useCollaborationPreset(userId);
    const query = useAvailableModels(userId, { enabled: true, membershipType });
    const models = useMemo(() => (query.data ?? []).filter(model => model.allowed !== false), [query.data]);
    const roles = useQuery({
        queryKey: queryKeys.agentProfiles(userId, membershipType),
        queryFn: ({ signal }) => fetchProfileOptions(signal),
        staleTime: 5 * 60_000,
    });
    const [editor, setEditor] = useState<{ index: number | null; member: AgentCollaborator } | null>(null);
    const update = (next: typeof preset) => writeCollaborationPreset(userId, next);
    const member = (index: number): AgentCollaborator => {
        const model = models[index % Math.max(models.length, 1)];
        return {
            id: crypto.randomUUID(),
            name: index === 0 ? '专项分析' : index === 1 ? '独立复核' : `协作 ${index + 1}`,
            model: model?.id ?? '',
            focus: index === 1 ? '独立核对依据、分歧和不确定性' : '',
            reasoning: !!model?.isReasoningDefault && model.reasoningAllowed !== false,
            reasoningEffort: null,
        };
    };
    // 模板 0–4 名；它们只是候选，不会让任何对话自动协作。
    const setMembers = (members: AgentCollaborator[]) => update({ ...preset, enabled: false, members });
    const saveMember = (next: AgentCollaborator) => {
        if (!editor) return;
        setMembers(editor.index === null
            ? [...preset.members, next]
            : preset.members.map((item, position) => position === editor.index ? next : item));
        setEditor(null);
    };

    return <section className="settings-form-section settings-form-section-divided" aria-label="多模型协作设置">
        <div className="settings-form-heading">
            <h3>多模型协作<BetaBadge /></h3>
            <p>为常用模型预设名称、角色和分工。</p>
        </div>
        <div className="settings-form-body">
          <div className="settings-inline-row settings-inline-row-top">
            <p className="settings-help">每个对话默认不协作；在输入框的模型菜单里勾选模型后才会启用，这里的预设会在勾选时自动套用。主模型不占成员名额，汇总只计一次费用。</p>
            <Button variant="secondary" size="lg" disabled={preset.members.length >= MAX_MEMBERS}
                onClick={() => setEditor({ index: null, member: member(preset.members.length) })}>
                <Plus size={14} aria-hidden="true" />添加成员
            </Button>
          </div>
          {preset.members.length ? (
            <ul className="settings-list-card" aria-label="协作成员">
              {preset.members.map((item, index) => {
                const role = roles.data?.find(option => option.name === (item.profile ?? DEFAULT_AGENT_PROFILE));
                const model = models.find(option => option.id === item.model);
                const effort = !item.reasoning ? '关闭推理'
                  : item.reasoningEffort ? EFFORT_LABELS.find(([level]) => level === item.reasoningEffort)?.[1] ?? '模型默认'
                    : '模型默认';
                return <li key={item.id} className="settings-list-item">
                  <div className="settings-list-item-text">
                    <strong>{item.name || `Agent ${index + 1}`}</strong>
                    <p>{[model?.name ?? (item.model || '未选择模型'), role?.displayName ?? '体系专家', effort].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="settings-actions">
                    <IconButton label={`编辑 Agent ${index + 1}`} size="sm" title="编辑"
                      onClick={() => setEditor({ index, member: { ...item } })}>
                      <Pencil size={16} aria-hidden="true" />
                    </IconButton>
                    <IconButton label={`移除 Agent ${index + 1}`} tone="danger" size="sm" title="移除"
                      onClick={() => setMembers(preset.members.filter((_, position) => position !== index))}>
                      <Trash2 size={16} aria-hidden="true" />
                    </IconButton>
                  </div>
                </li>;
              })}
            </ul>
          ) : null}
          <p className="settings-help">成员会同时收到已确认资料与实际工具结果，不自行猜测。</p>
        </div>
        {editor ? <CollaboratorDialog
          key={editor.member.id}
          member={editor.member}
          editing={editor.index !== null}
          models={models}
          roles={roles.data ?? []}
          rolesLoading={roles.isLoading}
          onClose={() => setEditor(null)}
          onSave={saveMember}
        /> : null}
    </section>;
}


function CollaboratorDialog({ member, editing, models, roles, rolesLoading, onClose, onSave }: {
    member: AgentCollaborator;
    editing: boolean;
    models: readonly AvailableModel[];
    roles: readonly AgentProfileOption[];
    rolesLoading: boolean;
    onClose: () => void;
    onSave: (next: AgentCollaborator) => void;
}) {
    const titleId = useId();
    const [draft, setDraft] = useState(member);
    const roleName = draft.profile ?? DEFAULT_AGENT_PROFILE;
    const role = roles.find(option => option.name === roleName);
    const model = models.find(option => option.id === draft.model);
    const roleModel = role?.model ? models.find(option => option.id === role.model) : undefined;
    const effort = draft.reasoning ? (draft.reasoningEffort ?? 'default') : 'off';
    const effortOptions = [
        { value: 'off', label: '关闭推理' },
        { value: 'default', label: '模型默认' },
        ...EFFORT_LABELS.filter(([level]) => level === draft.reasoningEffort || model?.thinkingLevels?.includes(level))
            .map(([level, label]) => ({ value: level, label })),
    ];

    return <Dialog bare open onClose={onClose} labelledBy={titleId} className="collab-dialog">
        <div className="collab-dialog-head">
            <h2 id={titleId}>{editing ? '编辑成员' : '添加成员'}</h2>
            <IconButton label="关闭" size="sm" onClick={onClose}><X size={17} aria-hidden="true" /></IconButton>
        </div>
        <div className="collab-dialog-body">
            <label className="settings-field">
                <span>名称</span>
                <Input  maxLength={60} value={draft.name} autoFocus
                    onChange={event => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <div className="collab-dialog-grid">
                <div className="settings-field">
                    <span>角色</span>
                    <Select
                        ariaLabel="角色"
                        value={roleName}
                        onChange={value => {
                            const rest = { ...draft };
                            delete rest.profile;
                            setDraft(value === DEFAULT_AGENT_PROFILE ? rest : { ...rest, profile: value });
                        }}
                        options={[
                            ...(!role ? [{ value: roleName, label: rolesLoading ? '加载角色…' : roleName === DEFAULT_AGENT_PROFILE ? '体系专家' : '角色已不可用' }] : []),
                            ...roles.map(option => ({ value: option.name, label: option.displayName })),
                        ]}
                    />
                </div>
                <div className="settings-field">
                    <span>模型</span>
                    <Select
                        ariaLabel="模型"
                        value={draft.model}
                        onChange={value => {
                            const next = models.find(option => option.id === value);
                            setDraft({
                                ...draft,
                                model: value,
                                reasoning: !!next && next.isReasoningDefault === true && next.reasoningAllowed !== false,
                                reasoningEffort: null,
                            });
                        }}
                        options={[
                            ...(!model ? [{ value: draft.model, label: draft.model ? '模型已不可用' : '选择模型' }] : []),
                            ...models.map(option => ({ value: option.id, label: option.name })),
                        ]}
                        placeholder="选择模型"
                    />
                </div>
                <div className="settings-field">
                    <span>努力程度</span>
                    <Select
                        ariaLabel="努力程度"
                        value={effort}
                        onChange={value => setDraft(value === 'off'
                            ? { ...draft, reasoning: false, reasoningEffort: null }
                            : { ...draft, reasoning: true, reasoningEffort: value === 'default' ? null : value as AgentCollaborator['reasoningEffort'] })}
                        options={effortOptions}
                    />
                </div>
            </div>
            <label className="settings-field">
                <span>分工</span>
                <Textarea  rows={3} maxLength={1200} value={draft.focus}
                    placeholder="分析角度或复核重点"
                    onChange={event => setDraft({ ...draft, focus: event.target.value })} />
            </label>
            {role && (role.description || roleModel) ? <p className="mcp-hint">
                {[role.description, roleModel ? `这个角色指定使用 ${roleModel.name}，会员可用时代替上面的模型。` : null].filter(Boolean).join(' ')}
            </p> : null}
        </div>
        <div className="collab-dialog-foot">
            <Button variant="ghost" size="lg" onClick={onClose}>取消</Button>
            <Button size="lg" disabled={!draft.name.trim()} onClick={() => onSave(draft)}>保存</Button>
        </div>
    </Dialog>;
}
