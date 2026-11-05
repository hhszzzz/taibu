'use client';
// 任务清单在行内展开：当前进度一行，点「查看」看完整清单。

import { useState } from 'react';
import { ChevronRight, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { AgentTodo } from '@/lib/agent/todos';

/** The chat shows one progress row; 查看 expands the full list in place. */
export function AgentTodoProgress({ items }: { items: AgentTodo[] }) {
    const [open, setOpen] = useState(false);
    if (!items.length) return null;
    const done = items.filter(item => item.status === 'completed').length;
    const current = items.find(item => item.status === 'in_progress');
    const next = items.find(item => item.status === 'pending');
    return <section className="agent-todo-progress" aria-label="任务清单">
        <div className="agent-todo-row">
            <ListChecks size={16} aria-hidden="true" />
            <strong>任务清单</strong>
            <span className="agent-todo-count">{done} / {items.length}</span>
            <span className="agent-todo-segments" aria-hidden="true">{items.slice(0, 12).map(item => <span key={item.id} data-state={item.status} />)}</span>
            <span className="agent-todo-current">{current ? `正在：${current.title}` : done === items.length ? '全部完成' : next ? `下一步：${next.title}` : ''}</span>
            <Button unstyled type="button" className="agent-todo-open" aria-expanded={open} onClick={() => setOpen(value => !value)}>
                {open ? '收起' : '查看'}<ChevronRight size={13} aria-hidden="true" className={open ? 'rotate-90' : undefined} />
            </Button>
        </div>
        {open && <ol className="agent-todo-list">
            {items.map(item => <li key={item.id} data-state={item.status}>
                <span aria-hidden="true">{item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○'}</span>{item.title}
            </li>)}
        </ol>}
    </section>;
}
