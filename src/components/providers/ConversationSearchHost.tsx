'use client';
/**
 * 全局搜索弹层（⌘K）：结构对齐 claude 实测——672×582 表面、大号无边框输入、
 * 分类 Tabs（全部 / 对话 / 记录 / 命盘）、「最近使用」「操作」分组、底部快捷键行。
 *
 * 行为：
 * - 空查询时列出最近对话（进入页面即预取），分组标题「最近使用」；
 * - ↑↓ 在结果间移动，←/→ 切换分类，`/` 回到输入框，Tab 用查询词撰写新对话，Enter 打开；
 * - 结果行悬停/选中时右侧出现「↵ 打开」提示（行级操作菜单未接入前不展示 ⋯ / ⌥↵ 假提示）；
 * - 对话契约（/api/search）与记录（/api/records）不变，不新增接口。
 */
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, NotebookText, Plus, Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { requestBrowserJson } from '@/lib/browser-api';
import { RECORD_CATEGORIES, type RecordCategory } from '@/lib/records';
import { getChartKindMeta } from '@/components/chat/agent/chart-registry';

type Result = { conversationId: string; messageId: string | null; title: string; preview: string };
type RecordResult = { id: string; title: string; content: string; category: RecordCategory; created_at?: string | null };
type ChartResult = { id: string; kind: 'bazi' | 'ziwei'; name: string; birth_date: string; birth_time: string | null };
type Filter = 'all' | 'conversation' | 'record' | 'chart';

const FILTERS: Array<{ value: Filter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'conversation', label: '对话' },
    { value: 'record', label: '记录' },
    { value: 'chart', label: '命盘' },
];
const categoryLabel = (category: RecordCategory) => RECORD_CATEGORIES.find(item => item.value === category)?.label ?? '记录';
const recordPreview = (content: string) => content.replace(/\s+/g, ' ').trim().slice(0, 90);

type Entry =
    | { kind: 'conversation'; key: string; title: string; preview: string; item: Result }
    | { kind: 'record'; key: string; title: string; preview: string; tag: string; item: RecordResult }
    | { kind: 'chart'; key: string; title: string; preview: string; tag: string; item: ChartResult };

export function ConversationSearchHost({ userId }: { userId: string | null }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const [active, setActive] = useState(0);
    const [result, setResult] = useState<{ owner: string; query: string; results: Result[] } | null>(null);
    const [charts, setCharts] = useState<{ owner: string; query: string; results: ChartResult[] } | null>(null);
    const [records, setRecords] = useState<{ owner: string; query: string; results: RecordResult[] } | null>(null);
    const [failure, setFailure] = useState<{ owner: string; query: string; message: string } | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const body = useRef<HTMLDivElement>(null);
    const router = useRouter();

    useEffect(() => {
        const show = () => { setOpen(true); setActive(0); };
        const key = (event: KeyboardEvent) => { if (!event.isComposing && event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); show(); } };
        window.addEventListener('keydown', key); window.addEventListener('taibu:search', show);
        return () => { window.removeEventListener('keydown', key); window.removeEventListener('taibu:search', show); };
    }, []);
    // 空查询也要有「最近使用」：打开时拉一次最近的对话（搜索接口对空词返回最近列表）。
    useEffect(() => {
        if (!open || !userId) return;
        const controller = new AbortController();
        void requestBrowserJson<{ results: Result[]; charts?: ChartResult[] }>('/api/search?q=', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
            .then(response => {
                if (controller.signal.aborted) return;
                setResult(previous => previous?.query === '' && previous.results.length ? previous : { owner: userId, query: '', results: response.data?.results ?? [] });
            })
            .catch(() => { /* 最近列表失败时仅省略分组 */ });
        return () => controller.abort();
    }, [open, userId]);
    useEffect(() => {
        if (!open || !query.trim() || !userId) return;
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
            void requestBrowserJson<{ results: Result[]; charts?: ChartResult[] }>(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal }).then(response => {
                if (controller.signal.aborted) return;
                setFailure({ owner: userId, query, message: response.error?.message ?? '' });
                setResult({ owner: userId, query, results: response.data?.results ?? [] });
                setCharts({ owner: userId, query, results: response.data?.charts ?? [] });
            }).catch(() => { if (!controller.signal.aborted) setFailure({ owner: userId, query, message: '搜索超时，请重试' }); });
            // 记录搜索是补充结果：失败时不遮蔽对话结果。
            void requestBrowserJson<{ records?: RecordResult[] }>(
                `/api/records?search=${encodeURIComponent(query.trim())}&pageSize=8`,
                { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) },
            ).then(response => {
                if (controller.signal.aborted) return;
                setRecords({ owner: userId, query, results: response.data?.records ?? [] });
            }).catch(() => { /* 记录检索失败时仅省略该分组 */ });
        }, 250);
        return () => { clearTimeout(timeout); controller.abort(); };
    }, [open, query, userId]);

    const conversations = useMemo(() => result?.owner === userId && result.query === query ? result.results : [], [result, userId, query]);
    const recordResults = useMemo(() => records?.owner === userId && records.query === query ? records.results : [], [records, userId, query]);
    const chartResults = useMemo(() => charts?.owner === userId && charts.query === query ? charts.results : [], [charts, userId, query]);
    const error = failure?.owner === userId && failure.query === query ? failure.message : '';
    const loading = !!query.trim() && !error && result?.query !== query;
    const recentOnly = !query.trim();

    const entries = useMemo<Entry[]>(() => [
        ...(filter === 'record' || filter === 'chart' ? [] : conversations.map(item => ({ kind: 'conversation' as const, key: `${item.conversationId}:${item.messageId}`, title: item.title || '对话', preview: item.preview, item }))),
        ...(filter === 'conversation' || filter === 'chart' ? [] : recordResults.map(item => ({ kind: 'record' as const, key: item.id, title: item.title || '未命名记录', preview: recordPreview(item.content), tag: categoryLabel(item.category), item }))),
        ...(filter === 'conversation' || filter === 'record' ? [] : chartResults.map(item => ({ kind: 'chart' as const, key: `${item.kind}:${item.id}`, title: item.name, preview: [item.birth_date, item.birth_time?.slice(0, 5)].filter(Boolean).join(' '), tag: item.kind === 'bazi' ? '八字' : '紫微', item }))),
    ], [filter, conversations, recordResults, chartResults]);

    const openEntry = useCallback((entry: Entry | undefined) => {
        if (!entry) return;
        setOpen(false);
        if (entry.kind === 'conversation') router.push(`/chat?id=${entry.item.conversationId}${entry.item.messageId ? `&message=${encodeURIComponent(entry.item.messageId)}` : ''}`);
        else if (entry.kind === 'record') router.push(`/records?id=${encodeURIComponent(entry.item.id)}`);
        else router.push(`/${entry.item.kind}/result?chart=${encodeURIComponent(entry.item.id)}`);
    }, [router]);
    const compose = useCallback(() => {
        if (!query.trim()) return;
        setOpen(false);
        router.push(`/chat?draft=${encodeURIComponent(query.trim())}`);
    }, [query, router]);

    // 键盘：Esc 关闭、↑↓ 移动、←→ 切分类、/ 回到输入框、Tab 撰写、Enter 打开。
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.isComposing) return;
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setActive(value => entries.length ? (value + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length : 0);
                return;
            }
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                setActive(0);
                setFilter(current => FILTERS[(FILTERS.findIndex(item => item.value === current) + (event.key === 'ArrowRight' ? 1 : -1) + FILTERS.length) % FILTERS.length].value);
                return;
            }
            if (event.key === '/' && document.activeElement !== input.current) { event.preventDefault(); input.current?.focus(); input.current?.select(); return; }
            if (event.key === 'Tab' && query.trim()) { event.preventDefault(); compose(); return; }
            if (event.key === 'Enter') { event.preventDefault(); openEntry(entries[active]); }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, entries, active, query, openEntry, compose]);

    useEffect(() => {
        const node = body.current?.querySelector<HTMLElement>('[data-active="true"]');
        node?.scrollIntoView({ block: 'nearest' });
    }, [active, entries]);

    const groups = recentOnly
        ? [{ label: '最近使用', items: entries }]
        : [
            { label: '对话', items: entries.filter(entry => entry.kind === 'conversation') },
            { label: '记录', items: entries.filter(entry => entry.kind === 'record') },
            { label: '命盘', items: entries.filter(entry => entry.kind === 'chart') },
        ].filter(group => group.items.length);

    const empty = !loading && !error && !recentOnly && entries.length === 0 && result?.query === query;

    return (
        <Modal open={open} onClose={() => setOpen(false)} initialFocusRef={input} labelledBy="search-title" className="search-palette">
            <h2 id="search-title" className="sr-only">搜索对话</h2>
            <div className="search-palette-head">
                <Search size={20} aria-hidden="true" />
                <input ref={input} value={query} maxLength={200} aria-label="搜索对话内容" placeholder="搜索"
                    onChange={event => { setQuery(event.target.value); setActive(0); }} />
                <button type="button" className="search-palette-close" aria-label="关闭" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="search-palette-tabs" role="tablist" aria-label="搜索范围">
                {FILTERS.map(item => <button key={item.value} type="button" role="tab" aria-selected={filter === item.value}
                    className="search-palette-tab" onClick={() => { setFilter(item.value); setActive(0); }}>{item.label}</button>)}
            </div>
            <div ref={body} className="search-palette-body">
                {!userId ? <p className="search-palette-state">登录后搜索自己的对话。</p>
                    : error && !entries.length ? <p className="search-palette-state" role="alert">{error}</p>
                    : loading ? <p className="search-palette-state" role="status">正在搜索…</p>
                    : empty ? <p className="search-palette-state">没有找到相关内容。</p>
                    : entries.length === 0 && recentOnly ? <p className="search-palette-state">还没有对话。</p>
                    : <>
                        {groups.map(group => <div key={group.label} className="search-palette-group-block">
                            <p className="search-palette-group">{group.label}</p>
                            {group.items.map(entry => {
                                const index = entries.indexOf(entry);
                                const isActive = index === active;
                                const Icon = entry.kind === 'conversation' ? MessageSquare : entry.kind === 'record' ? NotebookText : getChartKindMeta(entry.item.kind).icon;
                                return <div key={entry.key} className="search-palette-row" data-active={isActive || undefined} onMouseEnter={() => setActive(index)}>
                                    <button type="button" className="search-palette-item" onClick={() => openEntry(entry)}>
                                        <Icon size={18} aria-hidden="true" />
                                        <span className="search-palette-item-main">
                                            {/* strong 是验收脚本定位结果项的锚点；字重由 CSS 压回常规 */}
                                            <strong className="search-palette-item-title">{entry.title}
                                                {entry.kind !== 'conversation' && <span className="search-palette-item-tag">{entry.tag}</span>}
                                            </strong>
                                            {entry.preview && <span className="search-palette-item-preview">{entry.preview}</span>}
                                        </span>
                                    </button>
                                    {isActive && <span className="search-palette-actions" aria-hidden="true">
                                        <span className="search-palette-action">↵</span>
                                    </span>}
                                </div>;
                            })}
                        </div>)}
                        {!recentOnly && <div className="search-palette-group-block">
                            <p className="search-palette-group">操作</p>
                            <div className="search-palette-row">
                                <button type="button" className="search-palette-item" onClick={compose}>
                                    <Plus size={18} aria-hidden="true" />
                                    <span className="search-palette-item-main"><strong className="search-palette-item-title">新建对话</strong>
                                        <span className="search-palette-item-preview">用「{query.trim()}」开始新对话</span></span>
                                </button>
                            </div>
                        </div>}
                    </>}
            </div>
            <div className="search-palette-foot">
                <span className="search-palette-hint">关闭<kbd>Esc</kbd></span>
                <span className="search-palette-hint">切换类型<kbd>←</kbd><kbd>→</kbd></span>
                <span className="search-palette-hint">筛选条件<kbd>/</kbd></span>
                <span className="search-palette-hint">打开<kbd>↵</kbd></span>
                <span className="search-palette-hint is-end">撰写<kbd>Tab</kbd></span>
            </div>
        </Modal>
    );
}
