/**
 * MCP 服务编辑弹窗：管理员的平台服务与用户自己的连接器共用。
 *
 * 'use client' 标记说明：
 * - 草稿状态、动态增删请求头与密钥行、提交中状态
 *
 * 密钥只写不读：已保存的只显示名称，可以替换或删除；留空表示保持不变。
 */
'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, Trash2, Undo2, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { SettingsSelect } from '@/components/settings/SettingsSelect';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import {
  MCP_EXPOSURES, MCP_EXPOSURE_HINTS, MCP_EXPOSURE_LABELS, MCP_RESULT_CHARS_RANGE, MCP_SERVER_NAME_PATTERN, MCP_TIMEOUT_RANGE,
  MEMBERSHIP_TIERS, MEMBERSHIP_TIER_LABELS, USER_MCP_EXPOSURES,
  type McpExposure, type McpServerInput, type McpServerView,
} from '@/lib/agent/mcp/config';
import { MCP_PUBLIC_URL } from '@/lib/mcp-service-config';
import type { McpServerScope } from '@/lib/agent/mcp/client';
import type { MembershipType } from '@/lib/user/membership';

/** What the editor starts from: a saved server, or a template for a new one. */
export type McpEditorSeed =
  | { server: McpServerView }
  | { input: McpServerInput; secretHeader?: { name: string; placeholder: string } };

type Pair = { key: number; name: string; value: string };
type Secret = { key: number; name: string; stored: boolean; value: string; removed: boolean; placeholder?: string };
type Draft = {
  displayName: string;
  name: string;
  url: string;
  description: string;
  exposure: McpExposure;
  requiredTier: MembershipType;
  searchTool: string;
  fetchTool: string;
  routePriority: string;
  headers: Pair[];
  secretHeaders: Secret[];
  secretQuery: Secret[];
  timeoutSeconds: string;
  maxResultChars: string;
  sortOrder: string;
  enabled: boolean;
};

let rowKey = 0;
const nextKey = () => ++rowKey;
const stored = (name: string): Secret => ({ key: nextKey(), name, stored: true, value: '', removed: false });

function draftOf(seed: McpEditorSeed, scope: McpServerScope): Draft {
  if ('server' in seed) {
    const server = seed.server;
    return {
      displayName: server.displayName, name: server.name, url: server.url, description: server.description,
      exposure: server.exposure, requiredTier: server.requiredTier,
      searchTool: server.searchTool ?? '', fetchTool: server.fetchTool ?? '',
      routePriority: String(server.routePriority),
      headers: Object.entries(server.headers).map(([name, value]) => ({ key: nextKey(), name, value })),
      secretHeaders: server.secretHeaders.map(stored), secretQuery: server.secretQuery.map(stored),
      timeoutSeconds: String(server.timeoutMs / 1000), maxResultChars: String(server.maxResultChars),
      sortOrder: String(server.sortOrder), enabled: server.enabled,
    };
  }
  const { input, secretHeader } = seed;
  return {
    displayName: input.displayName, name: input.name, url: input.url, description: input.description ?? '',
    exposure: input.exposure ?? 'deferred', requiredTier: input.requiredTier ?? 'free',
    searchTool: input.searchTool ?? '', fetchTool: input.fetchTool ?? '',
    routePriority: String(input.routePriority ?? 100), headers: [],
    // 用户连接器默认给一行空白密钥，填了再保存；平台服务沿用模板。
    secretHeaders: secretHeader
      ? [{ key: nextKey(), name: secretHeader.name, stored: false, value: '', removed: false, placeholder: secretHeader.placeholder }]
      : scope === 'user' ? [{ key: nextKey(), name: '', stored: false, value: '', removed: false }] : [],
    secretQuery: [],
    timeoutSeconds: String(MCP_TIMEOUT_RANGE.default / 1000), maxResultChars: String(MCP_RESULT_CHARS_RANGE.default),
    sortOrder: '0', enabled: input.enabled ?? true,
  };
}

function integer(value: string, label: string, min: number, max: number) {
  const number = Number(value.trim());
  if (!value.trim() || !Number.isInteger(number) || number < min || number > max) throw new Error(`${label}须为 ${min}–${max} 的整数`);
  return number;
}

/** Write-only changes: a typed value sets or replaces, a removed stored secret becomes null, an untouched one is left out. */
function secretChanges(list: Secret[], label: string) {
  const changes: Record<string, string | null> = {};
  for (const secret of list) {
    const name = secret.name.trim();
    if (secret.stored) {
      if (secret.removed) changes[name] = null;
      else if (secret.value.trim()) changes[name] = secret.value.trim();
      continue;
    }
    if (!name && !secret.value.trim()) continue;
    if (!name) throw new Error(`请填写${label}的名称`);
    if (!secret.value.trim()) throw new Error(`请填写${label}「${name}」的值`);
    changes[name] = secret.value.trim();
  }
  return changes;
}

function autoName(source: string) {
  const base = source.toLowerCase().replace(/^https?:\/\//u, '').replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 24);
  return `mcp_${base || crypto.randomUUID().slice(0, 6)}`.slice(0, 31);
}

function isTaibuMcpUrl(value: string) {
  try {
    const target = new URL(value.trim());
    const self = new URL(MCP_PUBLIC_URL);
    return target.host === self.host && target.pathname.replace(/\/+$/u, '') === self.pathname.replace(/\/+$/u, '');
  } catch {
    return false;
  }
}

function payloadOf(draft: Draft, scope: McpServerScope): McpServerInput {
  const seconds = Number(draft.timeoutSeconds.trim());
  const timeoutMs = Math.round(seconds * 1000);
  if (!draft.timeoutSeconds.trim() || !Number.isFinite(seconds) || timeoutMs < MCP_TIMEOUT_RANGE.min || timeoutMs > MCP_TIMEOUT_RANGE.max)
    throw new Error(`超时须为 ${MCP_TIMEOUT_RANGE.min / 1000}–${MCP_TIMEOUT_RANGE.max / 1000} 秒`);
  const name = draft.name.trim() || (scope === 'user' ? autoName(draft.url || draft.displayName) : '');
  if (!MCP_SERVER_NAME_PATTERN.test(name)) throw new Error('标识须以小写字母开头，只能使用小写字母、数字和下划线');
  return {
    name, displayName: draft.displayName.trim(), description: draft.description.trim(), url: draft.url.trim(),
    headers: Object.fromEntries(draft.headers.filter(pair => pair.name.trim()).map(pair => [pair.name.trim(), pair.value])),
    secretHeaders: secretChanges(draft.secretHeaders, '密钥请求头'),
    secretQuery: secretChanges(draft.secretQuery, '密钥查询参数'),
    exposure: draft.exposure, enabled: draft.enabled, timeoutMs,
    maxResultChars: integer(draft.maxResultChars, '结果字数上限', MCP_RESULT_CHARS_RANGE.min, MCP_RESULT_CHARS_RANGE.max),
    sortOrder: integer(draft.sortOrder, '排序', -10_000, 10_000),
    ...(scope === 'platform' ? {
      requiredTier: draft.requiredTier,
      searchTool: draft.searchTool.trim() || null, fetchTool: draft.fetchTool.trim() || null,
      routePriority: integer(draft.routePriority, '路由优先级', 0, 1000),
    } : {}),
  };
}

type ControlProps = { id: string; 'aria-describedby'?: string };

/** A labelled control whose hint is its description, not part of its name. */
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

function SecretRows({ label, kind, list, onChange }: {
  label: string;
  kind: 'header' | 'query';
  list: Secret[];
  onChange: (next: Secret[]) => void;
}) {
  const update = (key: number, patch: Partial<Secret>) => onChange(list.map(item => item.key === key ? { ...item, ...patch } : item));
  return (
    <fieldset className="mcp-group">
      <legend>{label}</legend>
      {list.map(secret => (
        <div key={secret.key} className="mcp-pair">
          {secret.stored
            ? <span className="mcp-secret-state"><code>{secret.name}</code>{secret.removed ? ' · 保存后删除' : ' · 已设置'}</span>
            : <input className="settings-input" aria-label={`${label}名称`} placeholder={kind === 'header' ? '如 x-api-key' : '如 apiKey'}
              value={secret.name} spellCheck={false} autoComplete="off" onChange={event => update(secret.key, { name: event.target.value })} />}
          <input className="settings-input" type="password" aria-label={`${label}「${secret.name || '新密钥'}」的值`} autoComplete="new-password"
            spellCheck={false} disabled={secret.removed} value={secret.value}
            placeholder={secret.stored ? '留空则保持不变' : secret.placeholder ?? '密钥值'}
            onChange={event => update(secret.key, { value: event.target.value })} />
          {secret.stored && secret.removed
            ? <button type="button" className="settings-icon-button" aria-label={`保留「${secret.name}」`} title="撤销删除" onClick={() => update(secret.key, { removed: false })}><Undo2 size={16} aria-hidden="true" /></button>
            : <button type="button" className="settings-icon-button settings-icon-button-danger" aria-label={`删除「${secret.name || '新密钥'}」`} title="删除"
              onClick={() => secret.stored ? update(secret.key, { removed: true, value: '' }) : onChange(list.filter(item => item.key !== secret.key))}>
              <Trash2 size={16} aria-hidden="true" />
            </button>}
        </div>
      ))}
      <button type="button" className="settings-button settings-button-ghost mcp-add"
        onClick={() => onChange([...list, { key: nextKey(), name: '', stored: false, value: '', removed: false }])}>
        <Plus size={14} aria-hidden="true" />添加{kind === 'header' ? '密钥请求头' : '密钥查询参数'}
      </button>
    </fieldset>
  );
}

export function McpServerEditor({ scope, seed, onClose, onSubmit }: {
  scope: McpServerScope;
  /** Null while closed. */
  seed: McpEditorSeed | null;
  onClose: () => void;
  /** Resolves when saved; a rejection's message is shown in the dialog. */
  onSubmit: (input: McpServerInput) => Promise<void>;
}) {
  const titleId = useId();
  const toolsId = useId();
  const firstField = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ seed: McpEditorSeed | null; draft: Draft | null }>({ seed: null, draft: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new seed (opening the dialog) starts a fresh draft; closing keeps the last one for the exit animation.
  if (seed && seed !== state.seed) {
    setState({ seed, draft: draftOf(seed, scope) });
    setError(null);
  }
  const draft = state.draft;
  const editing = state.seed && 'server' in state.seed ? state.seed.server : null;
  const tools = editing?.snapshot?.tools ?? [];
  const exposures: readonly McpExposure[] = scope === 'platform' ? MCP_EXPOSURES : USER_MCP_EXPOSURES;
  const selfHosted = scope === 'user' && isTaibuMcpUrl(draft?.url ?? '');
  const set = (patch: Partial<Draft>) => setState(current => current.draft ? { ...current, draft: { ...current.draft, ...patch } } : current);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || saving) return;
    let input: McpServerInput;
    try {
      input = payloadOf(draft, scope);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '填写有误');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(input);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // A space sets the Latin acronym off from the verb before it.
  const noun = scope === 'platform' ? ' MCP 服务' : '连接器';
  return (
    <Modal open={seed !== null} onClose={() => { if (!saving) onClose(); }} labelledBy={titleId} busy={saving} className="mcp-editor" initialFocusRef={firstField}>
      {draft ? (
        <form onSubmit={event => { void submit(event); }} noValidate>
          <div className="mcp-editor-head">
            <h2 id={titleId}>{editing ? `编辑${noun}` : `添加${noun}`}</h2>
            <button type="button" className="settings-icon-button" aria-label="关闭" disabled={saving} onClick={onClose}><X size={17} aria-hidden="true" /></button>
          </div>
          <div className="mcp-editor-body">
            <div className="mcp-fields">
              <Field label="名称" wide hint="显示在设置页和工具卡片上。">
                {props => <input {...props} ref={firstField} className="settings-input" value={draft.displayName} maxLength={40} required onChange={event => set({ displayName: event.target.value })} />}
              </Field>
              {scope === 'platform' ? (
                <Field label="标识" hint={editing ? '用于工具名前缀；修改后工具名随之改变。' : '用于工具名前缀，如 notion、my_search。'}>
                  {props => <input {...props} className="settings-input" value={draft.name} maxLength={31} required spellCheck={false} autoComplete="off"
                    pattern="[a-z][a-z0-9_]{1,30}" onChange={event => set({ name: event.target.value.toLowerCase() })} />}
                </Field>
              ) : null}
              <Field label="服务地址" wide hint="Streamable HTTP 的公开 HTTPS 地址；不含密钥的查询参数可以直接写在地址里。">
                {props => <input {...props} className="settings-input" type="url" inputMode="url" value={draft.url} required spellCheck={false} autoComplete="off"
                  placeholder="https://example.com/mcp" onChange={event => set({ url: event.target.value })} />}
              </Field>
              {selfHosted ? <p className="mcp-notice is-wide" role="status">太卜已经有这个 MCP 了，不需要重复导入；可以直接在「Taibu MCP」页复制配置。</p> : null}
              <Field label="用途说明" wide hint={scope === 'platform' ? '写给模型看：这个服务能做什么、什么时候用。' : '写给 Agent 看：什么时候该用这个连接器。'}>
                {props => <textarea {...props} className="settings-textarea" rows={3} maxLength={2000} value={draft.description} onChange={event => set({ description: event.target.value })} />}
              </Field>
              {scope === 'platform' ? (
                <Field label="工具提供方式" wide hint={MCP_EXPOSURE_HINTS[draft.exposure]}>
                  {props => (
                    <SettingsSelect ariaLabel="工具提供方式" id={props.id} value={draft.exposure}
                      onChange={exposure => set({ exposure })} options={exposures.map(exposure => ({ value: exposure, label: MCP_EXPOSURE_LABELS[exposure] }))} />
                  )}
                </Field>
              ) : null}
              {scope === 'platform' ? (
                <Field label="会员等级" hint="达到这一等级的用户才能使用。">
                  {props => (
                    <SettingsSelect ariaLabel="会员等级" id={props.id} value={draft.requiredTier}
                      onChange={requiredTier => set({ requiredTier })} options={MEMBERSHIP_TIERS.map(tier => ({ value: tier, label: `${MEMBERSHIP_TIER_LABELS[tier]} 及以上` }))} />
                  )}
                </Field>
              ) : null}
            </div>

            {scope === 'platform' ? (
              <fieldset className="mcp-group">
                <legend>联网路由</legend>
                <p className="mcp-hint">填了搜索或读网页工具，这个服务就会承担 Agent 的 web_search / web_fetch 与普通对话的联网搜索：按优先级数字从小到大尝试，出错、超时或没有结果时转下一个，连续失败 3 次的服务暂停 1 分钟。工具名以测试连接列出的为准，返回内容自动识别。</p>
                <div className="mcp-fields">
                  <Field label="搜索工具">{props => <input {...props} className="settings-input" list={toolsId} value={draft.searchTool} spellCheck={false} onChange={event => set({ searchTool: event.target.value })} />}</Field>
                  <Field label="读网页工具">{props => <input {...props} className="settings-input" list={toolsId} value={draft.fetchTool} spellCheck={false} onChange={event => set({ fetchTool: event.target.value })} />}</Field>
                  <Field label="路由优先级">{props => <input {...props} className="settings-input" inputMode="numeric" value={draft.routePriority} onChange={event => set({ routePriority: event.target.value })} />}</Field>
                </div>
                <datalist id={toolsId}>{tools.map(tool => <option key={tool.name} value={tool.name} />)}</datalist>
              </fieldset>
            ) : null}

            <SecretRows label="密钥请求头" kind="header" list={draft.secretHeaders} onChange={secretHeaders => set({ secretHeaders })} />
            {scope === 'platform' ? (
              <>
                <SecretRows label="密钥查询参数" kind="query" list={draft.secretQuery} onChange={secretQuery => set({ secretQuery })} />
                <p className="mcp-hint">密钥加密保存，保存后不再显示；调用时才附加到请求上。</p>
              </>
            ) : <p className="mcp-hint">密钥加密保存，保存后不再显示。</p>}

            {scope === 'platform' ? <details className="mcp-advanced">
              <summary>高级设置</summary>
              <div className="mcp-advanced-body">
                <fieldset className="mcp-group">
                  <legend>普通请求头</legend>
                  {draft.headers.map(pair => (
                    <div key={pair.key} className="mcp-pair">
                      <input className="settings-input" aria-label="请求头名称" placeholder="名称" spellCheck={false} value={pair.name}
                        onChange={event => set({ headers: draft.headers.map(item => item.key === pair.key ? { ...item, name: event.target.value } : item) })} />
                      <input className="settings-input" aria-label={`请求头「${pair.name || '新请求头'}」的值`} placeholder="值" spellCheck={false} value={pair.value}
                        onChange={event => set({ headers: draft.headers.map(item => item.key === pair.key ? { ...item, value: event.target.value } : item) })} />
                      <button type="button" className="settings-icon-button settings-icon-button-danger" aria-label={`删除请求头「${pair.name || '新请求头'}」`}
                        onClick={() => set({ headers: draft.headers.filter(item => item.key !== pair.key) })}><Trash2 size={16} aria-hidden="true" /></button>
                    </div>
                  ))}
                  <button type="button" className="settings-button settings-button-ghost mcp-add" onClick={() => set({ headers: [...draft.headers, { key: nextKey(), name: '', value: '' }] })}>
                    <Plus size={14} aria-hidden="true" />添加请求头
                  </button>
                  <p className="mcp-hint">不能放密钥：名称像 key、token、auth 的请求头请填到密钥请求头。</p>
                </fieldset>
                <div className="mcp-fields">
                  <Field label="超时（秒）">{props => <input {...props} className="settings-input" inputMode="numeric" value={draft.timeoutSeconds} onChange={event => set({ timeoutSeconds: event.target.value })} />}</Field>
                  <Field label="结果字数上限" hint="超出时保留首尾、省略中间。">{props => <input {...props} className="settings-input" inputMode="numeric" value={draft.maxResultChars} onChange={event => set({ maxResultChars: event.target.value })} />}</Field>
                  <Field label="排序" hint="小的在前。">{props => <input {...props} className="settings-input" inputMode="numeric" value={draft.sortOrder} onChange={event => set({ sortOrder: event.target.value })} />}</Field>
                </div>
              </div>
            </details> : null}
          </div>
          <div className="mcp-editor-foot">
            {error ? <p role="alert">{error}</p> : null}
            <button type="button" className="settings-button" disabled={saving} onClick={onClose}>取消</button>
            <button type="submit" className="settings-button settings-button-primary" disabled={saving || selfHosted}>
              {saving ? <SoundWaveLoader variant="inline" /> : null}{editing ? '保存' : '添加并测试'}
            </button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
