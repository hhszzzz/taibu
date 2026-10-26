/**
 * MCP 服务列表：管理员的平台服务与用户自己的连接器共用。添加、编辑、启停、测试连接、删除，展开查看并设置工具。
 *
 * 'use client' 标记说明：
 * - 列表请求生命周期、编辑弹窗、测试中状态、删除确认与列表动效
 */
'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pencil, PlugZap, Plus, Trash2, Wrench } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { useListMotion } from '@/lib/motion/list';
import { mcpServerClient, type McpServerListing, type McpServerScope } from '@/lib/agent/mcp/client';
import {
  MCP_EXPOSURE_LABELS, MCP_SERVER_TEMPLATES, MEMBERSHIP_TIER_LABELS,
  type McpServerInput, type McpServerView, type McpToolPolicy,
} from '@/lib/agent/mcp/config';
import { McpServerEditor, type McpEditorSeed } from './McpServerEditor';
import { McpToolsPanel } from './McpToolsPanel';
import './mcp-settings.css';

type ListState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & McpServerListing);

const NO_SERVERS: McpServerView[] = [];
const CHECKED_FORMAT = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const BLANK: McpServerInput = { name: '', displayName: '', url: '' };

function checkedAt(value: string | null) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? CHECKED_FORMAT.format(date) : '';
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function statusOf(server: McpServerView) {
  const at = checkedAt(server.lastCheckedAt);
  // Set by a connection test, a task that could not connect, or search routing that kept failing.
  if (server.lastError) return `上次出错${at ? `（${at}）` : ''}：${server.lastError}`;
  if (server.snapshot) return `上次测试 ${at} · ${server.snapshot.tools.length} 个工具`;
  return '还没有测试连接';
}

export function McpServerManager({ scope, userId, notice, canAdd = true, addLabel, empty, onChanged }: {
  scope: McpServerScope;
  /** A member's requests are pinned to this account. */
  userId?: string;
  /** Shown above the list, e.g. what the member's allowance permits. */
  notice?: (listing: McpServerListing) => ReactNode;
  canAdd?: boolean | ((listing: McpServerListing) => boolean);
  addLabel: string;
  empty: { title: string; detail: string };
  onChanged?: () => void;
}) {
  const client = useMemo(() => mcpServerClient(scope, userId), [scope, userId]);
  const { showToast } = useToast();
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<McpEditorSeed | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [testing, setTesting] = useState<ReadonlySet<string>>(() => new Set());
  const [toggling, setToggling] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<McpServerView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const servers = state.status === 'ready' ? state.servers : NO_SERVERS;
  const listRef = useRef<HTMLUListElement>(null);
  const rows = useListMotion(listRef, servers, server => server.id);

  useEffect(() => {
    const controller = new AbortController();
    client.list(controller.signal).then(
      listing => setState({ status: 'ready', ...listing }),
      error => { if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : '读取失败' }); },
    );
    return () => controller.abort();
  }, [client, reload]);

  const replace = (server: McpServerView) => setState(current => current.status === 'ready'
    ? { ...current, servers: current.servers.map(item => item.id === server.id ? server : item) } : current);
  const counted = (delta: number) => (listing: McpServerListing) => listing.allowance
    ? { ...listing.allowance, used: Math.max(listing.allowance.used + delta, 0) } : undefined;

  const test = async (server: McpServerView) => {
    setTesting(current => new Set(current).add(server.id));
    try {
      const result = await client.test(server.id);
      replace(result.server);
      setExpanded(server.id);
      if (result.ok) showToast('success', `「${result.server.displayName}」连接成功，共 ${result.server.snapshot?.tools.length ?? 0} 个工具`);
      else showToast('error', `「${result.server.displayName}」连接失败：${result.server.lastError ?? '原因未知'}`);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '测试连接失败');
    } finally {
      setTesting(current => {
        const next = new Set(current);
        next.delete(server.id);
        return next;
      });
    }
  };

  const submit = async (input: McpServerInput) => {
    if (editor && 'server' in editor) {
      replace(await client.update(editor.server.id, input));
      setEditor(null);
      showToast('success', '已保存');
    } else {
      const created = await client.create(input);
      setState(current => current.status === 'ready'
        ? { ...current, servers: [...current.servers, created], allowance: counted(1)(current) } : current);
      setEditor(null);
      void test(created);
    }
    onChanged?.();
  };

  const toggle = async (server: McpServerView) => {
    setToggling(server.id);
    try {
      replace(await client.update(server.id, { enabled: !server.enabled }));
      onChanged?.();
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '保存失败');
    } finally {
      setToggling(null);
    }
  };

  const savePolicy = async (server: McpServerView, toolPolicy: Record<string, McpToolPolicy>) => {
    try {
      replace(await client.update(server.id, { toolPolicy }));
      showToast('success', '工具设置已保存');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '保存工具设置失败');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await client.remove(pendingDelete.id);
      const removed = pendingDelete.id;
      setState(current => current.status === 'ready'
        ? { ...current, servers: current.servers.filter(server => server.id !== removed), allowance: counted(-1)(current) } : current);
      setPendingDelete(null);
      showToast('success', `已删除「${pendingDelete.displayName}」`);
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
        <button type="button" onClick={() => { setState({ status: 'loading' }); setReload(value => value + 1); }}>重试</button>
      </div>
    );
  }

  const addable = typeof canAdd === 'function' ? canAdd(state) : canAdd;
  const noun = scope === 'platform' ? '服务' : '连接器';
  return (
    <div className="flex flex-col gap-4">
      {notice?.(state)}
      <div className="mcp-toolbar">
        <p>{scope === 'platform' ? `共 ${servers.length} 个服务` : state.allowance && state.allowance.limit > 0 ? `已添加 ${state.allowance.used} / ${state.allowance.limit} 个连接器` : `共 ${servers.length} 个连接器`}</p>
        <div className="settings-actions">
          {scope === 'platform' ? Object.entries(MCP_SERVER_TEMPLATES).map(([key, template]) => (
            <button key={key} type="button" className="settings-button" disabled={!addable}
              onClick={() => setEditor({ input: template.input, secretHeader: template.secretHeader })}>
              <Plus size={14} aria-hidden="true" />{template.label}
            </button>
          )) : null}
          <button type="button" className="settings-button settings-button-primary" disabled={!addable} onClick={() => setEditor({ input: BLANK })}>
            <Plus size={14} aria-hidden="true" />{addLabel}
          </button>
        </div>
      </div>
      {rows.length ? (
        <ul ref={listRef} className="settings-list-card" aria-label={scope === 'platform' ? 'MCP 服务' : '我的连接器'}>
          {rows.map(({ key, item: server }) => {
            const busy = testing.has(server.id);
            const open = expanded === server.id;
            const panelId = `mcp-tools-${server.id}`;
            return (
              <li key={key} data-motion-key={key} className="settings-list-item mcp-server">
                <div className="mcp-server-head">
                  <div className="settings-list-item-text">
                    <strong className="mcp-server-title">
                      {server.displayName}
                      <span className="mcp-badge">{MCP_EXPOSURE_LABELS[server.exposure]}</span>
                      {scope === 'platform' ? <span className="mcp-badge">{MEMBERSHIP_TIER_LABELS[server.requiredTier]}+</span> : null}
                      {server.searchTool || server.fetchTool
                        ? <span className="mcp-badge mcp-badge-accent">联网：{[server.searchTool && '搜索', server.fetchTool && '读网页'].filter(Boolean).join('、')}</span>
                        : null}
                      {server.enabled ? null : <span className="mcp-badge mcp-badge-muted">已停用</span>}
                    </strong>
                    <p className="mcp-server-line">{server.name} · {hostOf(server.url)}{server.searchTool || server.fetchTool ? ` · 路由优先级 ${server.routePriority}` : ''}</p>
                    <p className={server.lastError ? 'mcp-status-error' : undefined}>{statusOf(server)}</p>
                  </div>
                  <div className="mcp-actions">
                    <SettingsSwitch label={`启用「${server.displayName}」`} checked={server.enabled} disabled={toggling === server.id}
                      onToggle={() => { void toggle(server); }} />
                    <button type="button" className="settings-icon-button" aria-label={`测试「${server.displayName}」的连接`} title="测试连接"
                      disabled={busy} onClick={() => { void test(server); }}>
                      {busy ? <SoundWaveLoader variant="inline" /> : <PlugZap size={16} aria-hidden="true" />}
                    </button>
                    <button type="button" className="settings-icon-button" aria-label={`「${server.displayName}」的工具`} title="工具"
                      aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setExpanded(open ? null : server.id)}>
                      <Wrench size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="settings-icon-button" aria-label={`编辑「${server.displayName}」`} title="编辑" onClick={() => setEditor({ server })}>
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="settings-icon-button settings-icon-button-danger" aria-label={`删除「${server.displayName}」`} title="删除"
                      disabled={deleting} onClick={() => setPendingDelete(server)}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {open ? (
                  <McpToolsPanel id={panelId} server={server} testing={busy} onTest={() => { void test(server); }}
                    onSave={policy => savePolicy(server, policy)} />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mcp-empty">
          <p>{empty.title}</p>
          <p>{empty.detail}</p>
        </div>
      )}
      <McpServerEditor scope={scope} seed={editor} onClose={() => setEditor(null)} onSubmit={submit} />
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={confirmDelete}
        loading={deleting}
        variant="danger"
        title={`删除${noun}`}
        description={`删除「${pendingDelete?.displayName ?? ''}」后，它的工具与保存的密钥一并删除，进行中的任务下一次调用即被拒绝。`}
        confirmText="删除"
      />
    </div>
  );
}
