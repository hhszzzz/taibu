'use client';
// 需要读写协作预设与模型列表

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useAvailableModels } from '@/lib/hooks/useAvailableModels';
import { useCollaborationPreset, writeCollaborationPreset } from '@/lib/chat/collaboration-preset';
import type { AgentCollaborator } from '@/lib/chat/model-settings';
import { DEFAULT_AGENT_PROFILE } from '@/lib/agent/profiles/config';
import { fetchProfileOptions } from '@/lib/agent/profiles/client';
import { queryKeys } from '@/lib/query/keys';
import type { MembershipType } from '@/lib/user/membership';
import { BetaBadge } from '@/components/ui/BetaBadge';

const EFFORT_LABELS: ReadonlyArray<readonly [NonNullable<AgentCollaborator['reasoningEffort']>, string]> = [
    ['minimal', '最低'], ['low', '低'], ['medium', '中'], ['high', '高'], ['xhigh', '超高'], ['max', '最高'],
];

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
    const patchMember = (index: number, change: Partial<AgentCollaborator>) => setMembers(preset.members.map((item, position) => position === index ? { ...item, ...change } : item));
    return <section className="settings-form-section settings-form-section-divided" aria-label="多模型协作设置">
        <div className="settings-form-heading">
            <h3>多模型协作<BetaBadge /></h3>
            <p>每个对话默认不协作；在输入框的模型菜单里勾选模型后才会启用。这里为常用模型预设名称、角色、努力程度和分工，勾选时自动套用。主模型不占成员名额，汇总只计一次费用。</p>
        </div>
        {preset.members.map((item, index) => {
            const roleName = item.profile ?? DEFAULT_AGENT_PROFILE;
            const role = roles.data?.find(option => option.name === roleName);
            const roleModel = role?.model ? models.find(model => model.id === role.model) : undefined;
            return <fieldset key={item.id} className="settings-collab-member">
            <legend>Agent {index + 1}</legend>
            <div className="settings-collab-grid">
                <label className="settings-field"><span>名称</span>
                    <input className="settings-input" maxLength={60} value={item.name} aria-label={`Agent ${index + 1} 名称`}
                        onChange={event => patchMember(index, { name: event.target.value })} />
                </label>
                <label className="settings-field"><span>角色</span>
                    <select className="settings-select" value={roleName} aria-label={`Agent ${index + 1} 角色`}
                        onChange={event => {
                            const { profile: _previous, ...rest } = item;
                            setMembers(preset.members.map((member, position) => position !== index ? member
                                : event.target.value === DEFAULT_AGENT_PROFILE ? rest : { ...rest, profile: event.target.value }));
                        }}>
                        {!role && <option value={roleName}>{roles.isLoading ? '加载角色…' : roleName === DEFAULT_AGENT_PROFILE ? '体系专家' : '角色已不可用'}</option>}
                        {(roles.data ?? []).map(option => <option key={option.name} value={option.name}>{option.displayName}</option>)}
                    </select>
                </label>
                <label className="settings-field"><span>模型</span>
                    <select className="settings-select" value={item.model} aria-label={`Agent ${index + 1} 模型`}
                        onChange={event => {
                            const model = models.find(candidate => candidate.id === event.target.value);
                            patchMember(index, { model: event.target.value, reasoning: !!model && model.isReasoningDefault === true && model.reasoningAllowed !== false, reasoningEffort: null });
                        }}>
                        {!models.some(model => model.id === item.model) && <option value={item.model}>{query.isLoading ? '加载模型…' : '模型已不可用'}</option>}
                        {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                    </select>
                </label>
                <label className="settings-field"><span>努力程度</span>
                    <select className="settings-select" aria-label={`Agent ${index + 1} 努力程度`}
                        value={item.reasoning ? item.reasoningEffort ?? 'default' : 'off'}
                        onChange={event => {
                            const value = event.target.value;
                            patchMember(index, value === 'off'
                                ? { reasoning: false, reasoningEffort: null }
                                : { reasoning: true, reasoningEffort: value === 'default' ? null : value as AgentCollaborator['reasoningEffort'] });
                        }}>
                        <option value="off">关闭推理</option>
                        <option value="default">模型默认</option>
                        {/* 只列出所选模型支持的档位；保存过、但模型已不再支持的档位仍显示，运行时按最接近的档位执行。 */}
                        {EFFORT_LABELS.filter(([level]) => level === item.reasoningEffort || models.find(model => model.id === item.model)?.thinkingLevels?.includes(level))
                            .map(([level, label]) => <option key={level} value={level}>{label}</option>)}
                    </select>
                </label>
            </div>
            {role && (role.description || roleModel) ? <p className="settings-help">
                {[role.description, roleModel ? `这个角色指定使用 ${roleModel.name}，会员可用时代替上面的模型。` : null].filter(Boolean).join(' ')}
            </p> : null}
            <label className="settings-field"><span>分工</span>
                <textarea className="settings-textarea" rows={2} maxLength={1200} value={item.focus} aria-label={`Agent ${index + 1} 分工`}
                    placeholder="分析角度或复核重点" onChange={event => patchMember(index, { focus: event.target.value })} />
            </label>
            <div className="settings-actions">
                <button type="button" className="settings-button settings-button-compact settings-button-ghost" aria-label={`移除 Agent ${index + 1}`}
                    onClick={() => setMembers(preset.members.filter((_, position) => position !== index))}>
                    <Trash2 size={14} aria-hidden="true" />移除成员
                </button>
            </div>
        </fieldset>;
        })}
        <div className="settings-actions">
            <button type="button" className="settings-button" disabled={preset.members.length >= 4}
                onClick={() => setMembers([...preset.members, member(preset.members.length)])}>
                <Plus size={14} aria-hidden="true" />添加成员
            </button>
        </div>
        <p className="settings-help">成员会同时收到已确认资料与实际工具结果，不自行猜测。</p>
    </section>;
}
