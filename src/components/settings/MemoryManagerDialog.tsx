'use client';

/**
 * 管理助手长期记忆：查看全部、搜索、删除与手工新增。
 * 复用 /api/user/agent-memory 的 GET / POST / DELETE，不引入新的接口。
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { requestBrowserJson } from '@/lib/browser-api';
import type { AgentMemory } from '@/lib/agent/memory';

function memoryMatches(memory: AgentMemory, query: string) {
  const needle = query.trim().toLowerCase();
  return !needle || memory.content.toLowerCase().includes(needle);
}

// 界面只让用户写正文；存储仍需要标题与类型，标题取正文首行的前 40 个字符。
function titleOf(content: string) {
  return content.trim().split('\n')[0].slice(0, 40) || '记忆';
}

export function MemoryManagerDialog({
  open,
  onClose,
  userId,
  onCountChange,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  onCountChange?: (count: number) => void;
}) {
  const titleId = useId();
  const { showToast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [content, setContent] = useState('');

  const request = useCallback(<T,>(method: string, body?: unknown, signal?: AbortSignal) => (
    requestBrowserJson<T>('/api/user/agent-memory', {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Expected-User-Id': userId },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    })
  ), [userId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const result = await request<{ memories: AgentMemory[] }>('GET', undefined, signal);
      if (signal?.aborted) return;
      if (result.error) {
        setError(result.error.message || '读取长期记忆失败，请稍后重试');
        return;
      }
      setMemories(result.data?.memories ?? []);
    } catch {
      if (!signal?.aborted) setError('读取长期记忆失败，请稍后重试');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, open]);

  useEffect(() => {
    onCountChange?.(memories.length);
  }, [memories, onCountChange]);

  const filtered = useMemo(() => memories.filter(memory => memoryMatches(memory, query)), [memories, query]);
  const canAdd = content.trim().length > 0 && !busy;

  const remove = async (memory: AgentMemory) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await request<{ deleted: boolean }>('DELETE', { id: memory.id });
      if (result.error && result.status !== 404) {
        showToast('error', result.error.message || '删除记忆失败');
        return;
      }
      setMemories(current => current.filter(item => item.id !== memory.id));
      showToast('success', '记忆已删除');
    } catch {
      showToast('error', '删除记忆失败');
    } finally {
      setBusy(false);
      setConfirmingId(null);
    }
  };

  const add = async () => {
    if (!canAdd) return;
    setBusy(true);
    try {
      const text = content.trim();
      const result = await request<{ memory?: AgentMemory }>('POST', {
        title: titleOf(text),
        content: text,
        kind: 'context',
      });
      if (result.error) {
        showToast('error', result.error.message || '保存记忆失败');
        return;
      }
      setContent('');
      await load();
      showToast('success', '记忆已保存');
    } catch {
      showToast('error', '保存记忆失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} busy={busy} className="memory-manager-dialog" initialFocusRef={searchRef}>
      <header className="memory-manager-head">
        <div>
          <h2 id={titleId}>管理记忆</h2>
          <p>助手只保存你明确说过的偏好或事实；删除后，之后的任务不会再读取它。</p>
        </div>
        <button type="button" className="settings-icon-button" aria-label="关闭" onClick={onClose}><X size={16} /></button>
      </header>

      <div className="memory-manager-body">
        <div className="memory-manager-toolbar">
          <label className="memory-manager-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索记忆"
              aria-label="搜索记忆"
            />
          </label>
          <span className="settings-counter">{query.trim() ? `${filtered.length} 条匹配` : `共 ${memories.length} 条`}</span>
        </div>

        {loading ? (
          <div className="memory-manager-state"><SoundWaveLoader variant="inline" /></div>
        ) : error ? (
          <div className="memory-manager-state" role="alert">
            <p className="settings-alert">{error}</p>
            <button type="button" className="settings-button" onClick={() => void load()}>重新读取</button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="settings-help memory-manager-empty">{memories.length === 0 ? '还没有保存任何记忆。' : '没有匹配的记忆。'}</p>
        ) : (
          <ul className="settings-list-card memory-manager-list" aria-label="已保存记忆">
            {filtered.map(memory => (
              <li key={memory.id} className="settings-list-item">
                <div className="settings-list-item-text">
                  <p className="memory-manager-content">{memory.content}</p>
                </div>
                {confirmingId === memory.id ? (
                  <span className="memory-manager-confirm">
                    <button type="button" className="settings-text-button-danger" disabled={busy} onClick={() => void remove(memory)}>确认删除</button>
                    <button type="button" className="settings-button settings-button-ghost" disabled={busy} onClick={() => setConfirmingId(null)}>取消</button>
                  </span>
                ) : (
                  <button type="button" className="settings-icon-button settings-icon-button-danger" disabled={busy}
                    aria-label="删除这条记忆" title="删除" onClick={() => setConfirmingId(memory.id)}>
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <section className="memory-manager-add" aria-labelledby={`${titleId}-add`}>
          <h3 id={`${titleId}-add`}>添加记忆</h3>
          <textarea
            className="settings-textarea"
            value={content}
            maxLength={2000}
            rows={3}
            placeholder="记下希望长期保留的偏好或事实"
            aria-label="新记忆"
            disabled={busy}
            onChange={event => setContent(event.target.value.slice(0, 2000))}
          />
          <div className="memory-manager-add-actions">
            <span className="settings-counter">{content.length} / 2000</span>
            <button type="button" className="settings-button settings-button-primary" disabled={!canAdd} onClick={() => void add()}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
