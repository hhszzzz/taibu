/**
 * 角色编辑弹窗：管理员添加或修改自定义角色。内置角色只能启停，不经过这里。
 *
 * 'use client' 标记说明：
 * - 草稿状态与提交中状态
 *
 * 工具按「继承 + 允许 + 禁止」组合：继承即主任务的全部工具；允许、禁止可写工具族或单个工具名。
 * 只有主任务能用的工具（追问、清单、计划、派生成员、写记忆与档案、盘面定位、工具检索、脚本）无论怎么配都不会给成员。
 */
'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { SettingsSelect } from '@/components/settings/SettingsSelect';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { MEMBERSHIP_TIERS, MEMBERSHIP_TIER_LABELS } from '@/lib/agent/mcp/config';
import {
  AGENT_PROFILE_LIMITS, AGENT_PROFILE_MODES, AGENT_PROFILE_MODE_LABELS, AGENT_PROFILE_NAME_PATTERN, AGENT_PROFILE_TOOL_FAMILIES,
  BUILTIN_AGENT_PROFILE_NAMES, MCP_PROFILE_TOKEN, type AgentProfileEffort, type AgentProfileInput, type AgentProfileMode, type AgentProfileView,
} from '@/lib/agent/profiles/config';
import type { AgentProfileCatalog } from '@/lib/agent/profiles/client';
import { REASONING_EFFORT_LABELS } from '@/lib/chat/model-settings';
import { estimateTokens } from '@/lib/agent/token-estimate';
import { AI_REASONING_EFFORTS } from '@/types';
import type { MembershipType } from '@/lib/user/membership';

/** What the editor starts from: a custom role, or nothing for a new one. */
export type ProfileEditorSeed = { profile: AgentProfileView | null };

type Grant = '' | 'allow' | 'deny';
type Draft = {
  name: string; displayName: string; description: string; instructions: string;
  inherit: boolean; grants: Record<string, Grant>; extraAllow: string; extraDeny: string;
  skills: string[]; model: string; reasoningEffort: '' | AgentProfileEffort; modes: AgentProfileMode[];
  requiredTier: MembershipType; enabled: boolean; sortOrder: string;
};

/** The tokens the editor lists one per row: the families, then each platform service. */
function grantTokens(servers: AgentProfileCatalog['servers']) {
  return [
    ...AGENT_PROFILE_TOOL_FAMILIES.map(family => ({ token: family.token, label: family.label, hint: family.description })),
    ...servers.map(server => ({ token: `${MCP_PROFILE_TOKEN}${server.name}`, label: `MCP：${server.displayName}`, hint: server.enabled ? server.name : `${server.name}（已停用）` })),
  ];
}

function draftOf(seed: ProfileEditorSeed, listed: ReadonlySet<string>): Draft {
  const profile = seed.profile;
  const grants: Record<string, Grant> = {};
  const extra = { allow: [] as string[], deny: [] as string[] };
  for (const list of ['allow', 'deny'] as const) for (const token of profile?.tools[list] ?? []) {
    if (listed.has(token)) grants[token] = list;
    else extra[list].push(token);
  }
  return {
    name: profile?.name ?? '', displayName: profile?.displayName ?? '', description: profile?.description ?? '', instructions: profile?.instructions ?? '',
    inherit: profile?.tools.inherit ?? false, grants, extraAllow: extra.allow.join(' '), extraDeny: extra.deny.join(' '),
    skills: profile?.skills ?? [], model: profile?.model ?? '', reasoningEffort: profile?.reasoningEffort ?? '',
    modes: profile?.modes ?? [...AGENT_PROFILE_MODES], requiredTier: profile?.requiredTier ?? 'free', enabled: profile?.enabled ?? true,
    sortOrder: String(profile?.sortOrder ?? 0),
  };
}

const words = (text: string) => text.split(/[\s,，、]+/u).map(item => item.trim()).filter(Boolean);

function payloadOf(draft: Draft, creating: boolean): AgentProfileInput {
  if (creating && !AGENT_PROFILE_NAME_PATTERN.test(draft.name)) throw new Error('标识须以小写字母开头，由 2–32 个小写字母、数字或连字符组成');
  if (creating && BUILTIN_AGENT_PROFILE_NAMES.has(draft.name)) throw new Error(`「${draft.name}」是内置角色的标识`);
  if (!draft.displayName.trim()) throw new Error('请填写名称');
  if (!draft.modes.length) throw new Error('至少选择一种用途');
  const sortOrder = Number(draft.sortOrder.trim());
  if (!draft.sortOrder.trim() || !Number.isInteger(sortOrder) || Math.abs(sortOrder) > 10_000) throw new Error('排序须为 -10000–10000 的整数');
  const listed = (grant: Grant) => Object.entries(draft.grants).filter(([, value]) => value === grant).map(([token]) => token);
  return {
    ...(creating ? { name: draft.name } : {}),
    displayName: draft.displayName.trim(), description: draft.description.trim(), instructions: draft.instructions.trim(),
    tools: { inherit: draft.inherit, allow: [...listed('allow'), ...words(draft.extraAllow)], deny: [...listed('deny'), ...words(draft.extraDeny)] },
    skills: draft.skills, model: draft.model || null, reasoningEffort: draft.model && draft.reasoningEffort ? draft.reasoningEffort : null,
    modes: draft.modes, requiredTier: draft.requiredTier, enabled: draft.enabled, sortOrder,
  };
}

type ControlProps = { id: string; 'aria-describedby'?: string };

function Field({ label, hint, wide, children }: { label: string; hint?: ReactNode; wide?: boolean; children: (props: ControlProps) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={`settings-field${wide ? ' is-wide' : ''}`}>
      <label htmlFor={id} className="settings-label">{label}</label>
      {children(hint ? { id, 'aria-describedby': hintId } : { id })}
      {hint ? <span id={hintId} className="mcp-hint">{hint}</span> : null}
    </div>
  );
}

export function AgentProfileEditor({ seed, catalog, onClose, onSubmit }: {
  /** Null while closed. */
  seed: ProfileEditorSeed | null;
  catalog: Pick<AgentProfileCatalog, 'servers' | 'skills' | 'models'>;
  onClose: () => void;
  /** Resolves when saved; a rejection's message is shown in the dialog. */
  onSubmit: (input: AgentProfileInput, name: string | null) => Promise<void>;
}) {
  const titleId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const tokens = grantTokens(catalog.servers);
  const [state, setState] = useState<{ seed: ProfileEditorSeed | null; draft: Draft | null }>({ seed: null, draft: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new seed (opening the dialog) starts a fresh draft; closing keeps the last one for the exit animation.
  if (seed && seed !== state.seed) {
    setState({ seed, draft: draftOf(seed, new Set(tokens.map(item => item.token))) });
    setError(null);
  }
  const draft = state.draft;
  const editing = state.seed?.profile ?? null;
  const set = (patch: Partial<Draft>) => setState(current => current.draft ? { ...current, draft: { ...current.draft, ...patch } } : current);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !state.seed || saving) return;
    let input: AgentProfileInput;
    try {
      input = payloadOf(draft, !editing);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '填写有误');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(input, editing?.name ?? null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const model = catalog.models.find(item => item.id === draft?.model);
  return (
    <Modal open={seed !== null} onClose={() => { if (!saving) onClose(); }} labelledBy={titleId} busy={saving} className="mcp-editor profile-editor" initialFocusRef={firstRef}>
      {draft ? (
        <form onSubmit={event => { void submit(event); }} noValidate>
          <div className="mcp-editor-head">
            <h2 id={titleId}>{editing ? `编辑角色「${editing.displayName}」` : '添加角色'}</h2>
            <button type="button" className="settings-icon-button" aria-label="关闭" disabled={saving} onClick={onClose}><X size={17} aria-hidden="true" /></button>
          </div>
          <div className="mcp-editor-body">
            <div className="mcp-fields">
              <Field label="标识" hint={editing ? '保存后不能修改：协作预设与常驻子分析按标识找到角色。' : '小写字母开头，可含数字与连字符，如 case-reviewer。'}>
                {props => <input {...props} ref={firstRef} className="settings-input" value={draft.name} disabled={!!editing} maxLength={32} spellCheck={false}
                  onChange={event => set({ name: event.target.value.trim() })} />}
              </Field>
              <Field label="名称" hint={`成员卡片上的角色名，最多 ${AGENT_PROFILE_LIMITS.displayName} 个字。`}>
                {props => <input {...props} className="settings-input" value={draft.displayName} maxLength={AGENT_PROFILE_LIMITS.displayName}
                  onChange={event => set({ displayName: event.target.value })} />}
              </Field>
              <Field label="说明" wide hint="主任务挑选成员时读到的说明：这个角色擅长什么、什么时候用。">
                {props => <textarea {...props} className="settings-textarea" rows={2} maxLength={AGENT_PROFILE_LIMITS.description} value={draft.description}
                  onChange={event => set({ description: event.target.value })} />}
              </Field>
              <Field label="指令" wide hint={<>写给成员的做法，附在固定规则之后，不能放宽固定规则。约 {estimateTokens('', draft.instructions).toLocaleString('en-US')} token。</>}>
                {props => <textarea {...props} className="settings-textarea" rows={6} maxLength={AGENT_PROFILE_LIMITS.instructions} value={draft.instructions}
                  onChange={event => set({ instructions: event.target.value })} />}
              </Field>
            </div>
            <fieldset className="mcp-group">
              <legend>工具</legend>
              <label className="mcp-check">
                <input type="checkbox" checked={draft.inherit} onChange={event => set({ inherit: event.target.checked })} />
                继承主任务的全部工具
              </label>
              <p className="mcp-hint">不继承时只有「允许」的工具；「禁止」总是生效。追问用户、任务清单、提交计划、派生成员、写记忆与档案、盘面定位、工具检索与脚本只属于主任务，不会给成员。</p>
              <ul className="profile-grants">
                {tokens.map(item => (
                  <li key={item.token}>
                    <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                    <SettingsSelect<Grant> ariaLabel={`${item.label}的授权`} value={draft.grants[item.token] ?? ''}
                      onChange={value => set({ grants: { ...draft.grants, [item.token]: value } })}
                      options={[
                        { value: '', label: draft.inherit ? '随继承' : '不提供' },
                        { value: 'allow', label: '允许' },
                        { value: 'deny', label: '禁止' },
                      ]} />
                  </li>
                ))}
              </ul>
              <div className="mcp-fields">
                <Field label="另外允许的工具" hint="工具名，空格分隔，如 read_attachment。">
                  {props => <input {...props} className="settings-input" value={draft.extraAllow} spellCheck={false} onChange={event => set({ extraAllow: event.target.value })} />}
                </Field>
                <Field label="另外禁止的工具" hint="工具名，空格分隔，如 bazi_liunian_scan。">
                  {props => <input {...props} className="settings-input" value={draft.extraDeny} spellCheck={false} onChange={event => set({ extraDeny: event.target.value })} />}
                </Field>
              </div>
            </fieldset>
            <fieldset className="mcp-group">
              <legend>预载技能</legend>
              {catalog.skills.length ? (
                <div className="profile-checks">
                  {catalog.skills.map(skill => {
                    const checked = draft.skills.includes(skill.name);
                    return (
                      <label key={skill.name} className="mcp-check" title={skill.description}>
                        <input type="checkbox" checked={checked} disabled={!checked && draft.skills.length >= AGENT_PROFILE_LIMITS.skills}
                          onChange={() => set({ skills: checked ? draft.skills.filter(name => name !== skill.name) : [...draft.skills, skill.name] })} />
                        <code>{skill.name}</code>{skill.enabled ? null : '（已停用）'}
                      </label>
                    );
                  })}
                </div>
              ) : <p className="mcp-hint">还没有平台技能。</p>}
              <p className="mcp-hint">最多 {AGENT_PROFILE_LIMITS.skills} 个平台技能，正文随成员指令一起提供；用户当前会员不能用的技能不会载入。</p>
            </fieldset>
            <div className="mcp-fields">
              <Field label="模型" hint="不指定时，成员用协作设置里选的模型或主模型。指定的模型当前会员不能用时同样退回。">
                {props => (
                  <SettingsSelect ariaLabel="模型" id={props.id} describedBy={props['aria-describedby']} value={draft.model}
                    onChange={model => set({ model, reasoningEffort: '' })}
                    options={[
                      { value: '', label: '不指定' },
                      ...(draft.model && !model ? [{ value: draft.model, label: `${draft.model}（已不可用）` }] : []),
                      ...catalog.models.map(item => ({ value: item.id, label: item.name })),
                    ]} />
                )}
              </Field>
              <Field label="推理档位" hint="只对指定的模型生效，列出该模型支持的档位。">
                {props => (
                  <SettingsSelect<Draft['reasoningEffort']> ariaLabel="推理档位" id={props.id} describedBy={props['aria-describedby']}
                    value={draft.reasoningEffort} disabled={!draft.model || model?.supportsReasoning === false}
                    onChange={reasoningEffort => set({ reasoningEffort })}
                    options={[
                      { value: '', label: '模型默认' },
                      { value: 'off', label: '关闭推理' },
                      ...AI_REASONING_EFFORTS.filter(effort => effort === draft.reasoningEffort || model?.thinkingLevels.includes(effort))
                        .map(effort => ({ value: effort, label: REASONING_EFFORT_LABELS[effort] })),
                    ]} />
                )}
              </Field>
              <Field label="会员等级" hint="达到这一等级的用户才能派出这个角色。">
                {props => (
                  <SettingsSelect<MembershipType> ariaLabel="会员等级" id={props.id} describedBy={props['aria-describedby']}
                    value={draft.requiredTier} onChange={requiredTier => set({ requiredTier })}
                    options={MEMBERSHIP_TIERS.map(tier => ({ value: tier, label: `${MEMBERSHIP_TIER_LABELS[tier]} 及以上` }))} />
                )}
              </Field>
              <Field label="排序" hint="小的在前。">
                {props => <input {...props} className="settings-input" inputMode="numeric" value={draft.sortOrder} onChange={event => set({ sortOrder: event.target.value })} />}
              </Field>
              <fieldset className="mcp-group">
                <legend>用途</legend>
                <div className="profile-checks">
                  {AGENT_PROFILE_MODES.map(mode => (
                    <label key={mode} className="mcp-check">
                      <input type="checkbox" checked={draft.modes.includes(mode)}
                        onChange={event => set({ modes: AGENT_PROFILE_MODES.filter(item => item === mode ? event.target.checked : draft.modes.includes(item)) })} />
                      {AGENT_PROFILE_MODE_LABELS[mode]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="settings-field">
                <span className="settings-label" aria-hidden="true">启用</span>
                <SettingsSwitch label="启用这个角色" checked={draft.enabled} onToggle={() => set({ enabled: !draft.enabled })} />
              </div>
            </div>
          </div>
          <div className="mcp-editor-foot">
            {error ? <p role="alert">{error}</p> : null}
            <button type="button" className="settings-button" disabled={saving} onClick={onClose}>取消</button>
            <button type="submit" className="settings-button settings-button-primary" disabled={saving}>
              {saving ? <SoundWaveLoader variant="inline" /> : null}{editing ? '保存' : '添加'}
            </button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
