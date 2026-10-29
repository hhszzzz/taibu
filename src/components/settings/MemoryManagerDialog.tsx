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
import { SegmentedChoice } from '@/components/settings/SegmentedChoice';
import { requestBrowserJson } from '@/lib/browser-api';
import type { AgentMemory } from '@/lib/agent/memory';

const MEMORY_LIMIT = 128;
const MEMORY_KIND_OPTIONS = [
  { value: 'context' as const, label: '背景' },
  { value: 'preference' as const, label: '偏好' },
];

type MemoryKind = AgentMemory['kind'];

function memoryMatches(memory: AgentMemory, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return memory.title.toLowerCase().includes(needle) || memory.content.toLowerCase().includes(needle);
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
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [kind, setKind] = useState<MemoryKind>('context');

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
  const canAdd = title.trim().length > 0 && content.trim().length > 0 && !busy;

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
      const result = await request<{ memory?: AgentMemory }>('POST', {
        title: title.trim(),
        content: content.trim(),
        kind,
      });
      if (result.error) {
        showToast('error', result.error.message || '保存记忆失败');
        return;
      }
      setTitle('');
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
              placeholder="搜索标题或内容"
              aria-label="搜索记忆"
            />
          </label>
          <span className="settings-counter">{filtered.length} / {memories.length} · 上限 {MEMORY_LIMIT}</span>
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
                  <strong>{memory.title}<span className="memory-manager-kind">{memory.kind === 'preference' ? '偏好' : '背景'}</span></strong>
                  <p>{memory.content}</p>
                </div>
                {confirmingId === memory.id ? (
                  <span className="memory-manager-confirm">
                    <button type="button" className="settings-text-button-danger" disabled={busy} onClick={() => void remove(memory)}>确认删除</button>
                    <button type="button" className="settings-button settings-button-ghost" disabled={busy} onClick={() => setConfirmingId(null)}>取消</button>
                  </span>
                ) : (
                  <button type="button" className="settings-text-button-danger" disabled={busy} aria-label={`删除记忆：${memory.title}`} onClick={() => setConfirmingId(memory.id)}>
                    <Trash2 size={13} aria-hidden="true" />删除
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <section className="memory-manager-add" aria-labelledby={`${titleId}-add`}>
          <h3 id={`${titleId}-add`}>添加记忆</h3>
          <input
            className="settings-input"
            value={title}
            maxLength={80}
            placeholder="记忆标题"
            aria-label="新记忆标题"
            disabled={busy}
            onChange={event => setTitle(event.target.value.slice(0, 80))}
          />
          <textarea
            className="settings-textarea"
            value={content}
            maxLength={2000}
            rows={3}
            placeholder="主动保存希望长期保留的偏好或事实"
            aria-label="新记忆正文"
            disabled={busy}
            onChange={event => setContent(event.target.value.slice(0, 2000))}
          />
          <div className="memory-manager-add-actions">
            <SegmentedChoice ariaLabel="记忆类型" value={kind} onChange={setKind} options={MEMORY_KIND_OPTIONS} maxWidth={180} />
            <button type="button" className="settings-button settings-button-primary" disabled={!canAdd} onClick={() => void add()}>
              {busy ? '保存中…' : '保存这条记忆'}
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
