/**
 * MCP 服务的工具：最近一次测试连接看到的服务信息、服务自带说明与工具列表，以及逐个工具的启用、标题、检索词与确认设置。
 *
 * 'use client' 标记说明：
 * - 工具设置草稿与保存状态
 *
 * 工具名、描述、注解与服务说明都来自外部服务，只作为文本显示；服务说明不会提供给模型。
 */
'use client';

import { useState } from 'react';
import { SettingsSwitch } from '@/components/settings/SettingsControls';
import { Button } from '@/components/ui/Button';
import { useUnsavedSettingsGuard } from '@/lib/hooks/useUnsavedSettingsGuard';
import type { McpServerView, McpToolPolicy, McpToolSnapshot } from '@/lib/agent/mcp/config';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';

const ANNOTATIONS: Array<[keyof NonNullable<McpToolSnapshot['annotations']>, string]> = [
  ['readOnlyHint', '只读'], ['destructiveHint', '可能修改数据'], ['idempotentHint', '可重复调用'], ['openWorldHint', '访问外部'],
];

/** Only what differs from the defaults is kept, so an untouched tool has no entry. */
function cleaned(policy: Record<string, McpToolPolicy>) {
  const result: Record<string, McpToolPolicy> = {};
  for (const [name, item] of Object.entries(policy)) {
    const entry: McpToolPolicy = {
      ...(item.enabled === false ? { enabled: false } : {}),
      ...(item.title?.trim() ? { title: item.title.trim() } : {}),
      ...(item.keywords?.trim() ? { keywords: item.keywords.trim() } : {}),
      ...(item.confirm ? { confirm: true } : {}),
    };
    if (Object.keys(entry).length) result[name] = entry;
  }
  return result;
}

export function McpToolsPanel({ id, server, testing, onTest, onSave }: {
  id: string;
  server: McpServerView;
  testing: boolean;
  onTest: () => void;
  /** Settles once the save is done; the caller reports the outcome and never rejects. */
  onSave: (policy: Record<string, McpToolPolicy>) => Promise<void>;
}) {
  const [base, setBase] = useState(server.toolPolicy);
  const [draft, setDraft] = useState(server.toolPolicy);
  const [saving, setSaving] = useState(false);
  // A saved or reloaded server replaces the draft.
  if (server.toolPolicy !== base) {
    setBase(server.toolPolicy);
    setDraft(server.toolPolicy);
  }
  const snapshot = server.snapshot;
  const tools = snapshot?.tools ?? [];
  const dirty = JSON.stringify(cleaned(draft)) !== JSON.stringify(cleaned(base));
  useUnsavedSettingsGuard(dirty);
  const update = (name: string, patch: McpToolPolicy) => setDraft(current => ({ ...current, [name]: { ...current[name], ...patch } }));

  const save = async () => {
    setSaving(true);
    try {
      await onSave(cleaned(draft));
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = tools.filter(tool => draft[tool.name]?.enabled !== false).length;
  return (
    <div id={id} className="mcp-tools">
      <div className="mcp-tools-head">
        <span>
          {snapshot
            ? `${snapshot.server ? `${snapshot.server.title ?? snapshot.server.name} ${snapshot.server.version} · ` : ''}${tools.length} 个工具，启用 ${enabledCount} 个${snapshot.truncated ? '（服务提供的工具更多，只取了前面的）' : ''}`
            : '还没有测试连接。测试后会列出这个服务提供的工具。'}
        </span>
        <Button variant="secondary" size="sm" loading={testing} onClick={onTest}>
          {snapshot ? '重新测试' : '测试连接'}
        </Button>
      </div>
      {snapshot?.instructions ? (
        <details className="mcp-instructions">
          <summary>服务自带的说明（只在这里显示，不会提供给模型）</summary>
          <pre>{snapshot.instructions}</pre>
        </details>
      ) : null}
      {server.exposure === 'hidden' ? <p className="mcp-hint">这个服务不注册工具，只供联网路由使用；下面的设置在改为其他提供方式后生效。</p> : null}
      {server.exposure === 'codemode' ? <p className="mcp-hint">代码模式下，需要征求同意的工具不会注册。</p> : null}
      {tools.length ? (
        <ul className="mcp-tool-list" aria-label={`「${server.displayName}」的工具`}>
          {tools.map(tool => {
            const policy = draft[tool.name] ?? {};
            const notes = ANNOTATIONS.filter(([key]) => tool.annotations?.[key] === true);
            return (
              <li key={tool.name} className="mcp-tool">
                <div className="mcp-tool-text">
                  <span className="mcp-tool-name">
                    <code>{tool.name}</code>
                    {notes.map(([key, label]) => <span key={key} className="mcp-badge">{label}</span>)}
                  </span>
                  {tool.description ? <p className="mcp-tool-description" title={tool.description}>{tool.description}</p> : null}
                </div>
                <SettingsSwitch label={`启用工具 ${tool.name}`} checked={policy.enabled !== false} disabled={saving}
                  onToggle={() => update(tool.name, { enabled: policy.enabled === false })} />
                <div className="mcp-tool-fields">
                  <Input  aria-label={`工具 ${tool.name} 的中文标题`} maxLength={40} disabled={saving}
                    placeholder={tool.title ? `标题（默认：${tool.title}）` : '中文标题，显示在工具卡片上'} value={policy.title ?? ''}
                    onChange={event => update(tool.name, { title: event.target.value })} />
                  <Input  aria-label={`工具 ${tool.name} 的检索关键词`} maxLength={200} disabled={saving}
                    placeholder="检索关键词，空格分隔" value={policy.keywords ?? ''}
                    onChange={event => update(tool.name, { keywords: event.target.value })} />
                  <label className="mcp-check">
                    <Checkbox checked={policy.confirm === true} disabled={saving} onCheckedChange={checked => update(tool.name, { confirm: checked })} />
                    每次调用前征求用户同意
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {tools.length ? <p className="mcp-hint">标注来自服务自己的声明，仅供参考。会写入或删除数据的工具建议开启「征求同意」。</p> : null}
      {dirty ? (
        <div className="settings-actions">
          <Button loading={saving} disabled={saving} onClick={() => { void save(); }}>保存工具设置</Button>
          <Button variant="ghost" disabled={saving} onClick={() => setDraft(base)}>还原</Button>
        </div>
      ) : null}
    </div>
  );
}
