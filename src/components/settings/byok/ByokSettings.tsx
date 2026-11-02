/**
 * 自定义模型：成员自己的模型服务连接，每个连接下若干模型；卡片原地展开编辑。
 *
 * 'use client' 标记说明：
 * - 连接列表请求、展开中的编辑器、删除确认，以及这台设备保存的 Key
 *
 * Key 默认只在这台设备，浏览器直接请求服务商；打开「保存到本站」的连接由本站加密保存 Key 并代为请求，定时任务也能用。
 */
'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { IconButton } from '@/components/ui/IconButton';
import { ModelIcon } from '@/components/ui/ModelIcon';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { matchModelIcon } from '@/lib/ai/lobe-icons';
import { deleteByokConnection, useByokCatalog } from '@/lib/byok/client';
import { BYOK_PROTOCOL_LABELS, byokHost, type ByokCatalog, type ByokConnectionView, type ByokPolicy } from '@/lib/byok/config';
import { setDeviceKey, useDeviceKeys } from '@/lib/byok/device-keys';
import { readCollaborationPreset, writeCollaborationPreset } from '@/lib/chat/collaboration-preset';
import { queryKeys } from '@/lib/query/keys';
import { ByokConnectionEditor } from './ByokConnectionEditor';
import '../mcp/mcp-settings.css';
import './byok-settings.css';

const NEW = 'new';

function keyBadge(connection: ByokConnectionView, policy: ByokPolicy, deviceKey: string | undefined) {
  if (connection.keyHint) {
    return policy.allowServerKeys
      ? <span className="mcp-badge mcp-badge-accent">Key 保存在本站</span>
      : <span className="mcp-badge mcp-badge-muted" title="管理员已关闭「保存到本站」，已保存的 Key 暂不使用">本站保存已停用</span>;
  }
  return deviceKey ? <span className="mcp-badge">Key 在本设备</span> : <span className="mcp-badge mcp-badge-muted">本设备未填 Key</span>;
}

function modelCounts(connection: ByokConnectionView) {
  const images = connection.models.filter(model => model.usage === 'image').length;
  const chats = connection.models.length - images;
  if (!connection.models.length) return '还没有模型';
  return [chats && `${chats} 个对话模型`, images && `${images} 个生图模型`].filter(Boolean).join('、');
}

/** Removed models leave the collaboration preset too, so later runs do not name them. */
function dropPresetMembers(userId: string, refs: ReadonlySet<string>) {
  const preset = readCollaborationPreset(userId);
  if (!preset.members.some(member => refs.has(member.model))) return;
  writeCollaborationPreset(userId, { enabled: preset.enabled, members: preset.members.filter(member => !refs.has(member.model)) });
}

export function ByokSettings({ userId }: { userId: string }) {
  const { query, enabled } = useByokCatalog(userId);
  const keys = useDeviceKeys(userId);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ByokConnectionView | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!enabled) return <p className="mcp-notice"><strong>管理员已关闭自定义模型。</strong>已添加的连接会保留，重新开放后可以继续使用。</p>;
  if (query.isLoading) return <div className="flex min-h-[240px] items-center justify-center"><SoundWaveLoader variant="inline" /></div>;
  if (!query.data) {
    return (
      <div role="alert" className="settings-alert">
        <span className="min-w-0 flex-1">{query.error instanceof Error ? query.error.message : '自定义模型加载失败'}</span>
        <Button variant="ghost" size="xs" onClick={() => { void query.refetch(); }}>重试</Button>
      </div>
    );
  }

  const { connections, policy } = query.data;
  const update = (change: (catalog: ByokCatalog) => ByokCatalog) =>
    queryClient.setQueryData<ByokCatalog>(queryKeys.byok(userId), current => current ? change(current) : current);

  const afterSave = (connection: ByokConnectionView) => {
    const before = connections.find(item => item.id === connection.id);
    if (before) {
      const kept = new Set(connection.models.map(model => model.ref));
      dropPresetMembers(userId, new Set(before.models.map(model => model.ref).filter(ref => !kept.has(ref))));
    }
    update(catalog => ({
      ...catalog,
      connections: before ? catalog.connections.map(item => item.id === connection.id ? connection : item) : [...catalog.connections, connection],
    }));
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteByokConnection(userId, pendingDelete.id);
      setDeviceKey(userId, pendingDelete.id, null);
      dropPresetMembers(userId, new Set(pendingDelete.models.map(model => model.ref)));
      const removed = pendingDelete.id;
      update(catalog => ({ ...catalog, connections: catalog.connections.filter(item => item.id !== removed) }));
      if (editing === removed) setEditing(null);
      showToast('success', `已删除「${pendingDelete.name}」`);
      setPendingDelete(null);
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '删除连接失败');
    } finally {
      setDeleting(false);
    }
  };

  const full = connections.length >= policy.maxConnections;
  const editor = (connection: ByokConnectionView | null) => (
    <ByokConnectionEditor saved={connection} policy={policy} userId={userId} deviceKey={connection ? keys[connection.id] ?? null : null}
      onDone={afterSave} onCancel={() => setEditing(null)} onDelete={connection ? () => setPendingDelete(connection) : undefined} />
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="mcp-notice">
        <strong>Key 默认只保存在这台设备。</strong>浏览器直接请求服务商，退出登录时清除，换设备需要重新填写。
        打开「保存到本站」的连接由本站加密保存 Key 并代为请求，定时任务也能使用。自定义模型的调用不计费。
        {policy.allowServerKeys ? null : ' 管理员已关闭「保存到本站」：已保存的 Key 暂不使用，这些连接需要在本设备填写 Key。'}
      </p>
      <div className="mcp-toolbar">
        <p>共 {connections.length} / {policy.maxConnections} 个连接</p>
        <Button disabled={full || editing !== null} title={full ? `最多 ${policy.maxConnections} 个连接` : undefined} onClick={() => setEditing(NEW)}>
          <Plus size={14} aria-hidden="true" />添加连接
        </Button>
      </div>
      {connections.length || editing === NEW ? (
        <ul className="settings-list-card" aria-label="我的模型连接">
          {connections.map(connection => editing === connection.id ? (
            <li key={connection.id} className="settings-list-item byok-connection" data-editing="">{editor(connection)}</li>
          ) : (
            <li key={connection.id} className="settings-list-item byok-connection">
              <div className="mcp-server-head">
                <div className="settings-list-item-text">
                  <strong className="mcp-server-title">
                    {connection.name}
                    <span className="mcp-badge">{BYOK_PROTOCOL_LABELS[connection.protocol]}</span>
                    {keyBadge(connection, policy, keys[connection.id])}
                  </strong>
                  <p className="mcp-server-line">{byokHost(connection.baseUrl)} · {modelCounts(connection)}</p>
                  {connection.models.length ? (
                    <ul className="byok-chips" aria-label={`「${connection.name}」的模型`}>
                      {connection.models.map(model => (
                        <li key={model.id} className="byok-chip">
                          <ModelIcon icon={matchModelIcon(model.modelId)} vendor="other" size={14} />
                          {model.displayName}
                          {model.usage === 'image' ? <span className="byok-muted">生图</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="mcp-actions">
                  <IconButton label={`编辑「${connection.name}」`} size="sm" title="编辑" disabled={editing !== null}
                    onClick={() => setEditing(connection.id)}>
                    <Pencil size={16} aria-hidden="true" />
                  </IconButton>
                  <IconButton label={`删除「${connection.name}」`} tone="danger" size="sm" title="删除" disabled={editing !== null || deleting}
                    onClick={() => setPendingDelete(connection)}>
                    <Trash2 size={16} aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
            </li>
          ))}
          {editing === NEW ? <li className="settings-list-item byok-connection" data-editing="">{editor(null)}</li> : null}
        </ul>
      ) : (
        <div className="mcp-empty">
          <p>还没有自定义模型</p>
          <p>接入 OpenAI 兼容或 Anthropic 的接口后，可以在对话、识图、生图和多模型协作里使用自己的模型。</p>
        </div>
      )}
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={confirmDelete}
        loading={deleting}
        variant="danger"
        title="删除连接"
        description={`删除「${pendingDelete?.name ?? ''}」后，它的 ${pendingDelete?.models.length ?? 0} 个模型一并移除；正在使用它们的对话会改用平台默认模型。`}
        confirmText="删除"
      />
    </div>
  );
}
