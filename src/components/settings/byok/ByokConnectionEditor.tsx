/**
 * One connection opened in place: address with the request it resolves to, the key and where it lives, connection and
 * model tests, the provider's model list, and the models with what models.dev fills in.
 *
 * 'use client' 标记说明：
 * - 草稿、测试中状态、模型列表筛选与保存
 *
 * Tests run where the calls will run: with 「保存到本站」 on, the site makes them (also with the key it stores);
 * otherwise this browser does, which shows a provider that refuses cross-origin calls before anything is saved.
 */
'use client';

import { useState } from 'react';
import { Eye, EyeOff, Plus, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Field } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { ModelIcon } from '@/components/ui/ModelIcon';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { SegmentedChoice } from '@/components/settings/SegmentedChoice';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { matchModelIcon } from '@/lib/ai/lobe-icons';
import { fetchByokCapabilities, probeOnServer, saveByokConnection } from '@/lib/byok/client';
import {
  BYOK_PROTOCOL_LABELS, byokAddressError, byokEffortLevels, byokEndpoint, byokKeyHint, formatByokError, inferByokProtocol,
  normalizeByokAddress,
  type ByokConnectionView, type ByokDefaultEffort, type ByokPolicy, type ByokProtocol, type ByokUsage,
} from '@/lib/byok/config';
import { setDeviceKey } from '@/lib/byok/device-keys';
import {
  applyCapability, connectionBody, connectionDraft, draftChanged, guessUsage, nameFromAddress, newModelDraft, storedKeyMoves,
  type ByokConnectionDraft, type ByokModelDraft,
} from '@/lib/byok/draft';
import { byokBrowserFetch } from '@/lib/byok/pi-model';
import { probeByokConnection, testByokModel, type ByokListedModel } from '@/lib/byok/probe';
import { AI_REASONING_EFFORTS, type AIReasoningEffort } from '@/types';

const EFFORT_LABELS: Record<AIReasoningEffort, string> = { minimal: '最低', low: '低', medium: '中等', high: '高', xhigh: '超高', max: '最高' };
const PROTOCOL_OPTIONS = (['openai', 'anthropic'] as const).map(value => ({ value, label: BYOK_PROTOCOL_LABELS[value] }));
const PICKER_ROWS = 200;

type ConnectionTest =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; models: ByokListedModel[] }
  | { status: 'error'; message: string; alternative?: { baseUrl: string; models: ByokListedModel[] } };

type ModelTest =
  | { status: 'testing' }
  | { status: 'ok'; reply: string; note: string }
  | { status: 'error'; message: string };

const isLevel = (value: ByokDefaultEffort): value is AIReasoningEffort => AI_REASONING_EFFORTS.includes(value as AIReasoningEffort);

/** What the address resolves to, so a missing or extra `/v1` shows before saving. */
function AddressPreview({ protocol, address }: { protocol: ByokProtocol; address: string }) {
  if (!address.trim() || byokAddressError(address)) {
    return <>{protocol === 'anthropic'
      ? '填到域名即可，例如 https://api.anthropic.com；对话请求 /v1/messages。'
      : '填到域名或版本号即可，例如 https://api.deepseek.com；完整的 …/chat/completions 地址会原样使用。'}</>;
  }
  const endpoint = byokEndpoint(protocol, address);
  return <>实际请求 <code className="byok-url">{endpoint.chatUrl}</code>，模型列表 <code className="byok-url">{endpoint.modelsUrl}</code></>;
}

export function ByokConnectionEditor({ saved, policy, userId, deviceKey, onDone, onCancel, onDelete }: {
  /** The saved connection, or null for a new one. */
  saved: ByokConnectionView | null;
  policy: ByokPolicy;
  userId: string;
  /** This device's key for the connection. */
  deviceKey: string | null;
  onDone: (connection: ByokConnectionView) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<ByokConnectionDraft>(() => connectionDraft(saved));
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [connectionTest, setConnectionTest] = useState<ConnectionTest>({ status: 'idle' });
  const [modelTests, setModelTests] = useState<Record<string, ModelTest>>({});
  const [picker, setPicker] = useState<{ filter: string; selected: string[] } | null>(null);
  useUnsavedSettingsGuard(draftChanged(draft, saved));

  const patch = (value: Partial<ByokConnectionDraft>) => { setDraft(current => ({ ...current, ...value })); setError(''); };
  const patchModel = (key: string, value: Partial<ByokModelDraft>) => setDraft(current => ({
    ...current, models: current.models.map(model => model.key === key ? { ...model, ...value } : model),
  }));
  const address = normalizeByokAddress(draft.baseUrl);
  const keyMoves = storedKeyMoves(draft, saved);
  // With the switch on the site tests (and may use the key it stores); otherwise this browser tests with the key here.
  // Turning the switch on moves this device's key to the site unless another one is typed.
  const onSite = draft.storeOnSite;
  const canUseStoredKey = onSite && !!saved?.keyHint && !keyMoves;
  const testKey = draft.key.trim() || (canUseStoredKey ? '' : deviceKey ?? '');
  const modelRoom = policy.maxModelsPerConnection - draft.models.length;

  /** Null when a test can run; otherwise why not. */
  const testBlocked = (): string | null => byokAddressError(draft.baseUrl) ?? (testKey || canUseStoredKey ? null : '请先填写 API Key');

  const testConnection = async () => {
    const blocked = testBlocked();
    if (blocked) { setConnectionTest({ status: 'error', message: blocked }); return; }
    setConnectionTest({ status: 'testing' });
    const result = onSite
      ? await probeOnServer(userId, { connectionId: saved?.id ?? null, protocol: draft.protocol, baseUrl: address, apiKey: testKey || null, action: 'models' })
      : await probeByokConnection(draft.protocol, address, testKey, { fetch: byokBrowserFetch });
    if (result.ok) {
      setConnectionTest({ status: 'ok', models: result.models });
      return;
    }
    setConnectionTest({ status: 'error', message: formatByokError(result.failure, { browser: !onSite }), alternative: result.alternative });
  };

  const testModel = async (model: ByokModelDraft) => {
    const blocked = testBlocked() ?? (model.modelId.trim() ? null : '请先填写模型 ID');
    if (blocked) { setModelTests(current => ({ ...current, [model.key]: { status: 'error', message: blocked } })); return; }
    setModelTests(current => ({ ...current, [model.key]: { status: 'testing' } }));
    // The test asks for the model's default level, so a model that rejects levels is found before anyone chats with it.
    const effort = isLevel(model.defaultEffort) ? model.defaultEffort : null;
    const modelId = model.modelId.trim();
    const result = onSite
      ? await probeOnServer(userId, { connectionId: saved?.id ?? null, protocol: draft.protocol, baseUrl: address, apiKey: testKey || null, action: 'chat', modelId, effort })
      : await testByokModel({ protocol: draft.protocol, baseUrl: address, modelId, supportsVision: false, contextWindow: null, maxOutput: null },
        testKey, effort, { fetch: byokBrowserFetch });
    if (!result.ok) {
      setModelTests(current => ({ ...current, [model.key]: { status: 'error', message: formatByokError(result.failure, { browser: !onSite }) } }));
      return;
    }
    if (result.effort === 'rejected') patchModel(model.key, { defaultEffort: 'auto' });
    const note = result.effort === 'accepted' && effort ? `，接受努力程度「${EFFORT_LABELS[effort]}」`
      : result.effort === 'rejected' ? '；它不接受努力程度参数，默认已改为「模型默认」' : '';
    setModelTests(current => ({ ...current, [model.key]: { status: 'ok', reply: result.reply, note } }));
  };

  /** Fills a model in from models.dev once its ID is typed. */
  const fillModel = async (model: ByokModelDraft) => {
    const modelId = model.modelId.trim();
    if (!modelId || model.usage !== 'chat') return;
    const capability = (await fetchByokCapabilities(userId, [modelId]))[modelId];
    if (capability) setDraft(current => ({ ...current, models: current.models.map(item => item.key === model.key && item.modelId.trim() === modelId ? applyCapability(item, capability) : item) }));
  };

  const addModels = async (ids: string[]) => {
    const fresh = ids.filter(id => !draft.models.some(model => model.modelId.trim() === id)).slice(0, Math.max(modelRoom, 0));
    if (!fresh.length) return;
    const capabilities = await fetchByokCapabilities(userId, fresh.filter(id => guessUsage(id, draft.protocol) === 'chat'));
    setDraft(current => ({ ...current, models: [...current.models, ...fresh.map(id => newModelDraft(id, guessUsage(id, current.protocol), capabilities[id]))] }));
    setPicker(null);
  };

  const save = async () => {
    let body;
    try {
      body = connectionBody(onSite && !draft.key.trim() && testKey ? { ...draft, key: testKey } : draft, saved, policy);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '连接配置无效');
      return;
    }
    setSaving(true);
    try {
      const connection = await saveByokConnection(userId, saved?.id ?? null, body);
      const typed = draft.key.trim();
      // The key lives in one place: stored on the site, or kept on this device.
      if (body.key.store) setDeviceKey(userId, connection.id, null);
      else if (typed) setDeviceKey(userId, connection.id, typed);
      showToast('success', !body.key.store && !typed && !deviceKey ? '已保存；在这台设备填写 Key 后才能使用' : saved ? '已保存' : '已添加连接');
      onDone(connection);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存连接失败');
    } finally {
      setSaving(false);
    }
  };

  const keyToggle = showKey ? '隐藏 API Key' : '显示 API Key';
  const keyDescription = onSite
    ? keyMoves ? '接口地址换了域名，需要重新填写 Key。'
      : saved?.keyHint ? `已保存在本站（${saved.keyHint}），留空则不修改。`
        : deviceKey ? `留空则把这台设备的 Key（${byokKeyHint(deviceKey)}）移到本站加密保存。` : 'Key 加密保存在本站，只写不回显。'
    : deviceKey ? `已保存在这台设备（${byokKeyHint(deviceKey)}），留空则不修改。` : '只保存在这台设备的浏览器里，退出登录时清除。';
  const storeDescription = !policy.allowServerKeys
    ? saved?.keyHint ? '管理员已关闭「保存到本站」：已保存的 Key 暂不使用；关闭开关并保存会删除它。' : '管理员已关闭「保存到本站」。'
    : onSite ? '这个连接的调用由本站服务器发起，也能用于定时任务。'
      : saved?.keyHint ? '保存后本站删除已保存的 Key，改由这台设备的浏览器直接请求服务商。'
        : '由浏览器直接请求服务商（服务商需允许跨域）；定时任务不能使用。';
  const listed = connectionTest.status === 'ok' ? connectionTest.models : [];
  const filter = picker?.filter.trim().toLowerCase() ?? '';
  const pickable = listed.filter(model => !filter || model.id.toLowerCase().includes(filter) || model.name?.toLowerCase().includes(filter));

  return (
    <div className="byok-editor">
      <div className="mcp-fields">
        <Field label="名称">
          <Input value={draft.name} maxLength={40} placeholder={nameFromAddress(draft.baseUrl) || '例如 DeepSeek'}
            onChange={event => patch({ name: event.target.value })} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium leading-5 text-foreground">协议</span>
          <SegmentedChoice ariaLabel="协议" value={draft.protocol} options={PROTOCOL_OPTIONS} maxWidth={320}
            onChange={protocol => { patch({ protocol }); setConnectionTest({ status: 'idle' }); }} />
        </div>
        <Field label="接口地址" className="is-wide" description={<AddressPreview protocol={draft.protocol} address={draft.baseUrl} />}>
          <Input value={draft.baseUrl} inputMode="url" autoComplete="off" spellCheck={false} className="font-mono placeholder:font-sans"
            placeholder={draft.protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.deepseek.com'}
            onChange={event => {
              const baseUrl = event.target.value;
              // api.anthropic.com only speaks Messages.
              patch({ baseUrl, ...(inferByokProtocol(baseUrl) === 'anthropic' ? { protocol: 'anthropic' as const } : {}) });
              setConnectionTest({ status: 'idle' });
            }} />
        </Field>
        <Field label="API Key" className="is-wide" description={keyDescription}>
          {props => (
            <div className="relative">
              <Input {...props} type={showKey ? 'text' : 'password'} value={draft.key} autoComplete="off" spellCheck={false}
                className="pr-11 font-mono placeholder:font-sans" placeholder={saved?.keyHint && onSite && !keyMoves ? '留空则不修改' : 'sk-...'}
                onChange={event => patch({ key: event.target.value })} />
              <span className="absolute inset-y-0 right-1.5 flex items-center">
                <IconButton label={keyToggle} title={keyToggle} expand="none" className="h-8 w-8 rounded-lg" onClick={() => setShowKey(value => !value)}>
                  {showKey ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                </IconButton>
              </span>
            </div>
          )}
        </Field>
        <div className="is-wide byok-store">
          <div className="byok-store-text">
            <span>保存到本站</span>
            <p>{storeDescription}</p>
          </div>
          <Switch aria-label="保存到本站" checked={draft.storeOnSite} disabled={!policy.allowServerKeys && !draft.storeOnSite}
            onCheckedChange={checked => { patch({ storeOnSite: checked }); setConnectionTest({ status: 'idle' }); }} />
        </div>
      </div>

      <div className="byok-test">
        <Button variant="secondary" size="sm" loading={connectionTest.status === 'testing'} onClick={() => { void testConnection(); }}>
          <Zap size={14} aria-hidden="true" />测试连接
        </Button>
        {connectionTest.status === 'ok' ? (
          <p className="byok-result" data-tone="ok">
            连接成功，可用 {connectionTest.models.length} 个模型
            {connectionTest.models.length ? <Button variant="ghost" size="xs" onClick={() => setPicker(picker ? null : { filter: '', selected: [] })}>{picker ? '收起列表' : '从列表添加'}</Button> : null}
          </p>
        ) : null}
        {connectionTest.status === 'error' ? (
          <div className="byok-result" data-tone="error" role="alert">
            <p>{connectionTest.message}</p>
            {connectionTest.alternative ? <p>
              改用 <code className="byok-url">{connectionTest.alternative.baseUrl}</code> 可以连通。
              <Button variant="ghost" size="xs" onClick={() => {
                const alternative = connectionTest.status === 'error' ? connectionTest.alternative : undefined;
                if (!alternative) return;
                patch({ baseUrl: alternative.baseUrl });
                setConnectionTest({ status: 'ok', models: alternative.models });
              }}>改用这个地址</Button>
            </p> : null}
          </div>
        ) : null}
      </div>

      {picker && listed.length ? (
        <div className="byok-picker">
          <Input value={picker.filter} placeholder={`筛选 ${listed.length} 个模型`} aria-label="筛选模型"
            onChange={event => setPicker({ ...picker, filter: event.target.value })} />
          <ul className="byok-picker-list" aria-label="服务商提供的模型">
            {pickable.slice(0, PICKER_ROWS).map(model => {
              const added = draft.models.some(item => item.modelId.trim() === model.id);
              const checked = added || picker.selected.includes(model.id);
              return <li key={model.id}>
                <label className="mcp-check">
                  <Checkbox checked={checked} disabled={added}
                    onCheckedChange={() => setPicker({ ...picker, selected: checked ? picker.selected.filter(id => id !== model.id) : [...picker.selected, model.id] })} />
                  <ModelIcon icon={matchModelIcon(model.id)} vendor="other" size={16} />
                  <span className="font-mono">{model.id}</span>
                  {model.name ? <span className="byok-muted">{model.name}</span> : null}
                  {guessUsage(model.id, draft.protocol) === 'image' ? <span className="mcp-badge">生图</span> : null}
                </label>
              </li>;
            })}
          </ul>
          {pickable.length > PICKER_ROWS ? <p className="mcp-hint">只显示前 {PICKER_ROWS} 个，输入关键字缩小范围。</p> : null}
          <div className="settings-actions">
            <Button size="sm" disabled={!picker.selected.length || modelRoom <= 0} onClick={() => { void addModels(picker.selected); }}>
              添加所选（{picker.selected.length}）
            </Button>
            {modelRoom < picker.selected.length ? <span className="mcp-hint">每个连接最多 {policy.maxModelsPerConnection} 个模型</span> : null}
          </div>
        </div>
      ) : null}

      <section className="byok-models" aria-label="模型">
        <div className="byok-models-head">
          <h4>模型</h4>
          <Button variant="ghost" size="sm" disabled={modelRoom <= 0}
            onClick={() => setDraft(current => ({ ...current, models: [...current.models, newModelDraft('', 'chat')] }))}>
            <Plus size={14} aria-hidden="true" />添加模型
          </Button>
        </div>
        {draft.models.length ? draft.models.map(model => {
          const test = modelTests[model.key];
          const levels = byokEffortLevels(model.thinkingLevels);
          const chat = model.usage === 'chat';
          return <div key={model.key} className="byok-model">
            <div className="byok-model-main">
              <span className="byok-model-icon"><ModelIcon icon={matchModelIcon(model.modelId)} vendor="other" size={18} /></span>
              <Input size="sm" aria-label="模型 ID" value={model.modelId} className="font-mono placeholder:font-sans" placeholder="模型 ID，例如 deepseek-chat"
                autoComplete="off" spellCheck={false}
                onChange={event => patchModel(model.key, { modelId: event.target.value })}
                onBlur={() => { void fillModel(model); }} />
              <Input size="sm" aria-label="显示名称" className="byok-model-name" value={model.displayName === model.modelId ? '' : model.displayName}
                placeholder={model.modelId || '显示名称'} onChange={event => patchModel(model.key, { displayName: event.target.value })} />
              <div className="byok-model-usage">
                <Select<ByokUsage> ariaLabel="用途" value={model.usage} className="h-8 rounded-lg"
                  options={[{ value: 'chat', label: '对话' }, { value: 'image', label: '生图', disabled: draft.protocol === 'anthropic' }]}
                  onChange={usage => patchModel(model.key, { usage })} />
              </div>
              {chat ? <IconButton label={`测试「${model.modelId || '模型'}」`} title="测试" size="sm" disabled={test?.status === 'testing'}
                onClick={() => { void testModel(model); }}>
                <Zap size={16} aria-hidden="true" />
              </IconButton> : null}
              <IconButton label={`移除「${model.modelId || '模型'}」`} title="移除" tone="danger" size="sm"
                onClick={() => setDraft(current => ({ ...current, models: current.models.filter(item => item.key !== model.key) }))}>
                <Trash2 size={16} aria-hidden="true" />
              </IconButton>
            </div>
            {chat ? <div className="byok-model-detail">
              <label className="mcp-check">
                <Checkbox checked={model.supportsVision} onCheckedChange={supportsVision => patchModel(model.key, { supportsVision })} />识图
              </label>
              <Input size="sm" aria-label="上下文（token）" inputMode="numeric" value={model.contextWindow} placeholder="上下文（token）"
                onChange={event => patchModel(model.key, { contextWindow: event.target.value.trim() })} />
              <Input size="sm" aria-label="输出上限（token）" inputMode="numeric" value={model.maxOutput} placeholder="输出上限（token）"
                onChange={event => patchModel(model.key, { maxOutput: event.target.value.trim() })} />
              <Select<string> ariaLabel="默认努力程度" value={model.defaultEffort} className="h-8 rounded-lg"
                options={[
                  ...levels.map(level => ({ value: level, label: `默认：${EFFORT_LABELS[level]}` })),
                  { value: 'auto', label: '默认：模型默认' },
                  { value: 'off', label: '默认：关闭推理' },
                ]}
                onChange={value => patchModel(model.key, { defaultEffort: value as ByokDefaultEffort })} />
              <p className="mcp-hint is-wide">
                {model.thinkingLevels.length ? `努力程度：${levels.map(level => EFFORT_LABELS[level]).join(' / ')}` : '努力程度档位未知：模型菜单提供全部档位。'}
              </p>
            </div> : <p className="mcp-hint">生图模型调用 /images/generations，在输入框「生图」与 Agent 生图中使用。</p>}
            {test ? <p className="byok-result" data-tone={test.status === 'error' ? 'error' : test.status === 'ok' ? 'ok' : undefined} role={test.status === 'error' ? 'alert' : 'status'}>
              {test.status === 'testing' ? '正在测试…' : test.status === 'ok' ? `可用：回复「${test.reply || '（空）'}」${test.note}` : test.message}
            </p> : null}
          </div>;
        }) : <p className="mcp-hint">还没有模型：手动添加，或测试连接后从服务商的列表里选。</p>}
      </section>

      <div className="byok-editor-foot">
        {error ? <p role="alert">{error}</p> : null}
        {onDelete ? <Button variant="ghost" size="lg" className="hover:text-danger" disabled={saving} onClick={onDelete}>删除连接</Button> : null}
        <span className="byok-spacer" />
        <Button variant="ghost" size="lg" disabled={saving} onClick={onCancel}>取消</Button>
        <Button size="lg" loading={saving} onClick={() => { void save(); }}>{saved ? '保存' : '添加'}</Button>
      </div>
    </div>
  );
}
