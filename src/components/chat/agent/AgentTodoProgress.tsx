'use client';
// 需要读取工作区上下文，在工作区打开“过程”

import { ChevronRight, ListChecks } from 'lucide-react';
import type { AgentTodo } from '@/lib/agent/todos';
import { useAgentResultWorkspace } from './AgentResultContext';

/** The chat shows one progress row; the full list opens in the workspace process section. */
export function AgentTodoProgress({ items }: { items: AgentTodo[] }) {
    const workspace = useAgentResultWorkspace();
    if (!items.length) return null;
    const done = items.filter(item => item.status === 'completed').length;
    const current = items.find(item => item.status === 'in_progress');
    const next = items.find(item => item.status === 'pending');
    const list = <ol className="agent-todo-list">
        {items.map(item => <li key={item.id} data-state={item.status}>
            <span aria-hidden="true">{item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○'}</span>{item.title}
        </li>)}
    </ol>;
    return <section className="agent-todo-progress" aria-label="任务清单">
        <div className="agent-todo-row">
            <ListChecks size={16} aria-hidden="true" />
            <strong>任务清单</strong>
            <span className="agent-todo-count">{done} / {items.length}</span>
            <span className="agent-todo-segments" aria-hidden="true">{items.slice(0, 12).map(item => <span key={item.id} data-state={item.status} />)}</span>
            <span className="agent-todo-current">{current ? `正在：${current.title}` : done === items.length ? '全部完成' : next ? `下一步：${next.title}` : ''}</span>
            {workspace && <button type="button" className="agent-todo-open" onClick={() => workspace.openResource('process')}>查看<ChevronRight size={13} aria-hidden="true" /></button>}
        </div>
        {!workspace && <details><summary>展开清单</summary>{list}</details>}
    </section>;
}
