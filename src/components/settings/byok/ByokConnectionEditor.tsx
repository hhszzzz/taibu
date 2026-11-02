/**
 * One connection opened in place: address with the request it resolves to, the key and where it lives, connection and
 * model tests, and models picked from the provider's list or typed by hand, with what models.dev fills in.
 *
 * 'use client' 标记说明：
 * - 草稿、测试中状态、模型列表筛选与保存
 *
 * Tests run where the calls will run: with 「保存到本站」 on, the site makes them (also with the key it stores);
 * otherwise this browser does, which shows a provider that refuses cross-origin calls before anything is saved.
 */
'use client';

import { useState } from 'react';
import { ChevronDown, Eye, EyeOff, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Field } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { ModelIcon } from '@/components/ui/ModelIcon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { SegmentedChoice } from '@/components/settings/SegmentedChoice';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import { matchModelIcon } from '@/lib/ai/lobe-icons';
import { fetchByokCapabilities, probeOnServer, saveByokConnection } from '@/lib/byok/client';
import {
  BYOK_PROTOCOL_LABELS, byokAddressError, byokEffortLevels, formatByokError, inferByokProtocol,
  normalizeByokAddress,
  type ByokConnectionView, type ByokDefaultEffort, type ByokPolicy, type ByokUsage,
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
const MAX_OPTIONS = 50;

type ConnectionTest =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'error'; message: string; alternative?: { baseUrl: string; models: ByokListedModel[] } };

type ModelTest =
  | { status: 'testing' }
  | { status: 'ok'; reply: string; note: string }
  | { status: 'error'; message: string };

const isLevel = (value: ByokDefaultEffort): value is AIReasoningEffort => AI_REASONING_EFFORTS.includes(value as AIReasoningEffort);

/** 1048576 → 1M, 393216 → 393K. */
function formatTokens(value: string): string {
  const tokens = Number(value);
  if (!Number.isFinite(tokens) || tokens <= 0) return '';
  const scaled = (number: number) => number >= 100 ? String(Math.round(number)) : String(Number(number.toFixed(1)));
  if (tokens >= 1_000_000) return `${scaled(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${scaled(tokens / 1_000)}K`;
  return String(tokens);
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
  const [fetchingModels, setFetchingModels] = useState(false);
  /** The provider's list, read by 「获取模型」; each model ID input offers it. */
  const [listed, setListed] = useState<ByokListedModel[]>([]);
  const [modelListError, setModelListError] = useState('');
  /** The model row whose ID input has the provider's list open. */
  const [openRow, setOpenRow] = useState<string | null>(null);
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
    const blocked = byokAddressError(draft.baseUrl);
    if (blocked) { setConnectionTest({ status: 'error', message: blocked }); return; }
    setConnectionTest({ status: 'testing' });
    const result = onSite
      ? await probeOnServer(userId, { connectionId: saved?.id ?? null, protocol: draft.protocol, baseUrl: address, apiKey: testKey || null, action: 'models' })
      : await probeByokConnection(draft.protocol, address, testKey, { fetch: byokBrowserFetch });
    // The key is checked by the model list and model tests; here a 401 means the service answered, so the address works.
    if (result.ok || result.failure.status === 401 || result.failure.status === 403) {
      setConnectionTest({ status: 'idle' });
      showToast('success', '连接成功');
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

  /** Reads the provider's list so each model ID input can offer it. */
  const fetchModels = async () => {
    const blocked = testBlocked();
    if (blocked) { setModelListError(blocked); return; }
    setFetchingModels(true);
    setModelListError('');
    const result = onSite
      ? await probeOnServer(userId, { connectionId: saved?.id ?? null, protocol: draft.protocol, baseUrl: address, apiKey: testKey || null, action: 'models' })
      : await probeByokConnection(draft.protocol, address, testKey, { fetch: byokBrowserFetch });
    setFetchingModels(false);
    if (!result.ok) {
      setModelListError(formatByokError(result.failure, { browser: !onSite }));
      return;
    }
    setListed(result.models);
    showToast('success', `已获取 ${result.models.length} 个模型`);
    if (!draft.models.length && modelRoom > 0) {
      const row = newModelDraft('', 'chat');
      setDraft(current => ({ ...current, models: [...current.models, row] }));
      setOpenRow(row.key);
    }
  };

  /** Picks a model from the provider's list into a row, with what models.dev knows about it. */
  const pickModel = async (model: ByokModelDraft, listed: ByokListedModel) => {
    const usage = guessUsage(listed.id, draft.protocol);
    setOpenRow(null);
    const capability = usage === 'chat' ? (await fetchByokCapabilities(userId, [listed.id]))[listed.id] : null;
    const next = { ...newModelDraft(listed.id, usage, capability), key: model.key, id: model.id, displayName: listed.name ?? listed.id };
    setDraft(current => ({ ...current, models: current.models.map(item => item.key === model.key ? next : item) }));
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
    ? 'Key 加密保存在本站，只写不回显。'
    : '只保存在这台设备的浏览器里，退出登录时清除；定时任务无法使用。出现其他错误时，请打开「保存到本站」。';
  const storeDescription = !policy.allowServerKeys
    ? saved?.keyHint ? '管理员已关闭「保存到本站」：已保存的 Key 暂不使用；关闭开关并保存会删除它。' : '管理员已关闭「保存到本站」。'
    : 'Key 加密保存在本站，请求由本站发出，可用定时任务等完整权限。';

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
        <Field label="接口地址" className="is-wide">
          {props => (
            <div className="byok-address">
              <div className="byok-address-row">
                <Input {...props} value={draft.baseUrl} inputMode="url" autoComplete="off" spellCheck={false} className="font-mono placeholder:font-sans"
                  placeholder={draft.protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.deepseek.com'}
                  onChange={event => {
                    const baseUrl = event.target.value;
                    // api.anthropic.com only speaks Messages.
                    patch({ baseUrl, ...(inferByokProtocol(baseUrl) === 'anthropic' ? { protocol: 'anthropic' as const } : {}) });
                    setConnectionTest({ status: 'idle' });
                    setListed([]);
                  }} />
                <Button variant="secondary" size="sm" loading={connectionTest.status === 'testing'} onClick={() => { void testConnection(); }}>
                  <Zap size={14} aria-hidden="true" />测试连接
                </Button>
              </div>
              {connectionTest.status === 'error' ? (
                <div className="byok-result" data-tone="error" role="alert">
                  <p>{connectionTest.message}</p>
                  {connectionTest.alternative ? <p>
                    改用 <code className="byok-url">{connectionTest.alternative.baseUrl}</code> 可以连通。
                    <Button variant="ghost" size="xs" onClick={() => {
                      const alternative = connectionTest.status === 'error' ? connectionTest.alternative : undefined;
                      if (!alternative) return;
                      patch({ baseUrl: alternative.baseUrl });
                      setListed([]);
                      setConnectionTest({ status: 'idle' });
                      showToast('success', '连接成功');
                    }}>改用这个地址</Button>
                  </p> : null}
                </div>
              ) : null}
            </div>
          )}
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

      <section className="byok-models" aria-label="模型">
        <div className="byok-models-head">
          <h4>模型</h4>
          <div className="byok-models-actions">
            <Button variant="ghost" size="sm" loading={fetchingModels} onClick={() => { void fetchModels(); }}>
              <RefreshCw size={14} aria-hidden="true" />获取模型
            </Button>
            <Button variant="ghost" size="sm" disabled={modelRoom <= 0}
              onClick={() => setDraft(current => ({ ...current, models: [...current.models, newModelDraft('', 'chat')] }))}>
              <Plus size={14} aria-hidden="true" />添加模型
            </Button>
          </div>
        </div>
        {modelListError ? <p className="byok-result" data-tone="error" role="alert">{modelListError}</p> : null}
        {draft.models.length ? draft.models.map(model => {
          const test = modelTests[model.key];
          const levels = byokEffortLevels(model.thinkingLevels);
          const chat = model.usage === 'chat';
          const query = model.modelId.trim().toLowerCase();
          const offered = listed.filter(item => !query || item.id.toLowerCase().includes(query) || item.name?.toLowerCase().includes(query));
          const open = openRow === model.key;
          return <div key={model.key} className="byok-model">
            <div className="byok-model-main">
              <span className="byok-model-icon"><ModelIcon icon={matchModelIcon(model.modelId)} vendor="other" size={18} /></span>
              <div className="byok-model-id">
                <Popover open={open} onOpenChange={next => setOpenRow(next ? model.key : null)}>
                  <Input size="sm" aria-label="模型 ID" value={model.modelId} className="pr-8 font-mono placeholder:font-sans" placeholder="模型 ID，例如 deepseek-chat"
                    autoComplete="off" spellCheck={false}
                    onFocus={() => setOpenRow(model.key)}
                    onChange={event => patchModel(model.key, { modelId: event.target.value })}
                    onBlur={() => { void fillModel(model); }} />
                  <span className="absolute inset-y-0 right-1 flex items-center">
                    <PopoverTrigger className="byok-model-id-toggle" aria-label="选择服务商的模型" title="选择服务商的模型"
                      onClick={() => { if (!listed.length) void fetchModels(); }}>
                      <ChevronDown size={14} aria-hidden="true" />
                    </PopoverTrigger>
                  </span>
                  <PopoverContent side="bottom" align="end" sideOffset={4} className="byok-model-options">
                    {listed.length ? (
                      <div role="group" aria-label="服务商的模型">
                        {offered.slice(0, MAX_OPTIONS).map(item => (
                          <Button unstyled key={item.id} type="button" className="byok-model-option" aria-pressed={item.id === model.modelId}
                            onClick={() => { void pickModel(model, item); }}>
                            <ModelIcon icon={matchModelIcon(item.id)} vendor="other" size={16} />
                            <span className="font-mono">{item.id}</span>
                            {item.name ? <span className="byok-muted">{item.name}</span> : null}
                            {guessUsage(item.id, draft.protocol) === 'image' ? <span className="mcp-badge">生图</span> : null}
                          </Button>
                        ))}
                        {offered.length > MAX_OPTIONS ? <p className="byok-option-hint">只显示前 {MAX_OPTIONS} 个，继续输入可缩小范围。</p> : null}
                      </div>
                    ) : (
                      <div className="byok-model-empty">
                        <span>{fetchingModels ? '正在获取模型列表…' : modelListError || '还没有获取模型列表'}</span>
                        {fetchingModels ? null : <Button variant="ghost" size="xs" onClick={() => { void fetchModels(); }}>获取模型</Button>}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
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
              <Select<string> ariaLabel="默认努力程度" value={model.defaultEffort} className="h-8 rounded-lg"
                options={[
                  ...levels.map(level => ({ value: level, label: `默认：${EFFORT_LABELS[level]}` })),
                  { value: 'auto', label: '默认：模型默认' },
                  { value: 'off', label: '默认：关闭推理' },
                ]}
                onChange={value => patchModel(model.key, { defaultEffort: value as ByokDefaultEffort })} />
              <p className="mcp-hint is-wide">
                {model.contextWindow ? `上下文 ${formatTokens(model.contextWindow)}` : ''}
                {model.contextWindow ? ' · ' : ''}
                {model.thinkingLevels.length ? `努力程度：${levels.map(level => EFFORT_LABELS[level]).join(' / ')}` : '努力程度档位未知：模型菜单提供全部档位。'}
              </p>
            </div> : <p className="mcp-hint">生图模型调用 /images/generations，在输入框「生图」与 Agent 生图中使用。</p>}
            {test ? <p className="byok-result" data-tone={test.status === 'error' ? 'error' : test.status === 'ok' ? 'ok' : undefined} role={test.status === 'error' ? 'alert' : 'status'}>
              {test.status === 'testing' ? '正在测试…' : test.status === 'ok' ? `可用：回复「${test.reply || '（空）'}」${test.note}` : test.message}
            </p> : null}
          </div>;
        }) : <p className="mcp-hint">还没有模型：点「获取模型」从服务商的列表里选，或手动添加。</p>}
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
