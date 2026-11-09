'use client';
/**
 * 全局搜索弹层（⌘K）：结构对齐 claude 实测——672×582 表面、大号无边框输入、
 * 分类 Tabs（全部 / 占术 / 对话 / 记录 / 设置）、「最近使用」「操作」分组、底部快捷键行。
 *
 * 行为：
 * - 空查询时列出最近对话、占术记录与常用设置，分组标题「最近使用 / 占术 / 记录 / 设置」；
 * - 输入「昨天」「10月」「2026-10-20」直接按时间筛选占术记录与命理记录，并显示可关闭的时间条件；
 * - 「六爻」这类占术名直接列出该占术保存下来的记录，点击取回详情再打开结果页；
 * - 设置项跳到对应设置页并高亮区块；
 * - ↑↓ 在结果间移动，`/` 回到输入框，Tab 用查询词撰写新对话，Enter 打开；
 * - 结果行悬停/选中时右侧出现「↵ 打开」提示。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { requestBrowserJson } from '@/lib/browser-api';
import { RECORD_CATEGORIES, type RecordCategory } from '@/lib/records';
import { conversationHref } from '@/lib/chat/conversation-href';
import { parseSearchTime } from '@/lib/chat/search-time';
import { HISTORY_TYPES, type HistoryType } from '@/lib/history/registry';
import { applyHistoryRestorePayload, loadHistoryRestore } from '@/lib/history/client';
import { getDataSourceFeatureId, getDataSourceNavId } from '@/lib/data-sources/catalog';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { TYPE_ICONS } from '@/components/chat/mention/mention-constants';
import { useFeatureToggles } from '@/lib/hooks/useFeatureToggles';
import { useCurrentUserProfile } from '@/lib/hooks/useCurrentUserProfile';
import { getSettingsCenterRouteTarget, getSettingsCenterTabs, type SettingsCenterFlags, type SettingsCenterTab } from '@/lib/settings-center';
import { SETTINGS_CENTER_TAB_ICONS, SETTINGS_SEARCH_ITEM_ICONS } from '@/components/settings/settings-center-icons';
import { AgentIcon, ChatIcon, RecordsIcon } from '@/lib/navigation/nav-icons';
import { matchSettingsSearchItems, recommendedSettingsSearchItems, type SettingsSearchItem } from '@/lib/settings-search';
import { useToast } from '@/components/ui/Toast';
import type { ReactNode } from 'react';

type Result = { conversationId: string; messageId: string | null; title: string; preview: string; hasAgentRun?: boolean };
type RecordResult = { id: string; title: string; content: string; category: RecordCategory; created_at?: string | null };
type ArtResult = Pick<DataSourceSummary, 'id' | 'type' | 'name' | 'preview' | 'createdAt'>;
type Filter = 'all' | 'art' | 'conversation' | 'record' | 'setting';

const FILTERS: Array<{ value: Filter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'art', label: '占术' },
    { value: 'conversation', label: '对话' },
    { value: 'record', label: '记录' },
    { value: 'setting', label: '设置' },
];
/** 记录行：标题旁的分类标签只给命理记录，占术由图标表达。 */
const categoryLabel = (category: RecordCategory) => RECORD_CATEGORIES.find(item => item.value === category)?.label ?? '记录';
const recordPreview = (content: string) => content.replace(/\s+/g, ' ').trim().slice(0, 90);
/** 记录副标题只保留信息量：问题、生日、分数；复述卦象/牌阵/类型的行不再重复。 */
function artPreview(title: string, preview: string): string {
    const text = preview.trim();
    if (!text || text.replace(/\s+/gu, '') === title.replace(/\s+/gu, '')) return '';
    return /^(?:本卦|变卦|牌阵|类型|人格类型)[：:]/u.test(text) ? '' : preview;
}
/** 命盘与合盘不写记录日期：把生日或匹配度直接放到标题行，去掉与标题重复的类型。 */
function undatedArtMeta(item: ArtResult): string {
    if (item.type === 'bazi_chart' || item.type === 'ziwei_chart') {
        return item.preview.replace(/^(?:八字命盘|紫微命盘)\s*-\s*/u, '');
    }
    if (item.type === 'hepan_chart') {
        return item.preview.startsWith('类型：') ? '' : item.preview.split(' / ')[0];
    }
    return '';
}
/** Every search request gets its own 8s budget on top of the panel's abort signal. */
const withSearchTimeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(8000)]);

type Entry =
    | { kind: 'conversation'; key: string; title: string; preview: string; icon: ReactNode; item: Result }
    | { kind: 'record'; key: string; title: string; preview: string; tag: string; icon: ReactNode; item: RecordResult }
    | { kind: 'art'; key: string; title: string; preview: string; meta?: string; icon: ReactNode; item: ArtResult }
    | { kind: 'setting'; key: string; title: string; preview: string; icon: ReactNode; item: SettingsSearchItem };

/** 结果里的日期：同年只写月日，跨年写完整日期。 */
function resultDate(value: string | null | undefined, now = new Date()): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.getFullYear() === now.getFullYear()
        ? `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function ConversationSearchHost({ userId }: { userId: string | null }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const [active, setActive] = useState(0);
    const [result, setResult] = useState<{ owner: string; query: string; results: Result[] } | null>(null);
    const [records, setRecords] = useState<{ owner: string; query: string; results: RecordResult[] } | null>(null);
    const [arts, setArts] = useState<{ owner: string; query: string; results: ArtResult[] } | null>(null);
    const [failure, setFailure] = useState<{ owner: string; query: string; message: string } | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const body = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const { showToast } = useToast();
    const { isFeatureEnabled, loaded: featureTogglesLoaded } = useFeatureToggles();
    const { profile } = useCurrentUserProfile({ enabled: open && !!userId });
    const isAdmin = !!profile?.is_admin;

    const flags = useMemo<SettingsCenterFlags>(() => ({
        sharesEnabled: !featureTogglesLoaded || isFeatureEnabled('shares'),
        skillsEnabled: !featureTogglesLoaded || isFeatureEnabled('skills'),
        connectorsEnabled: !featureTogglesLoaded || isFeatureEnabled('connectors'),
        billingEnabled: !featureTogglesLoaded || isFeatureEnabled('billing'),
        usageLogEnabled: !featureTogglesLoaded || isFeatureEnabled('usage-log'),
        chartsEnabled: !featureTogglesLoaded || isFeatureEnabled('charts'),
        knowledgeBaseEnabled: !featureTogglesLoaded || isFeatureEnabled('knowledge-base'),
        mcpServiceEnabled: !featureTogglesLoaded || isFeatureEnabled('mcp-service'),
        agentEnabled: !featureTogglesLoaded || isFeatureEnabled('agent'),
        personalizationEnabled: featureTogglesLoaded && isFeatureEnabled('chat') && isFeatureEnabled('ai-personalization'),
        byokEnabled: !featureTogglesLoaded || isFeatureEnabled('byok'),
        helpEnabled: !featureTogglesLoaded || isFeatureEnabled('help'), isAdmin,
    }), [featureTogglesLoaded, isAdmin, isFeatureEnabled]);
    const settingsTabs = useMemo<SettingsCenterTab[]>(
        () => getSettingsCenterTabs(flags).filter(tab => !tab.disabled).map(tab => tab.id),
        [flags],
    );

    useEffect(() => {
        const show = () => { setOpen(true); setActive(0); };
        const key = (event: KeyboardEvent) => { if (!event.isComposing && event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); show(); } };
        window.addEventListener('keydown', key); window.addEventListener('taibu:search', show);
        return () => { window.removeEventListener('keydown', key); window.removeEventListener('taibu:search', show); };
    }, []);
    // 空查询也要有推荐：最近对话、最近占术记录与常用设置，打开即可选择。
    useEffect(() => {
        if (!open || !userId || query.trim()) return;
        const controller = new AbortController();
        const signal = withSearchTimeout(controller.signal);
        void requestBrowserJson<{ results: Result[] }>('/api/search?q=', { signal })
            .then(response => {
                if (controller.signal.aborted) return;
                setResult({ owner: userId, query, results: response.data?.results ?? [] });
            })
            .catch(() => { /* 最近列表失败时仅省略分组 */ });
        void requestBrowserJson<{ items?: ArtResult[] }>('/api/search/arts?q=', { signal })
            .then(response => { if (!controller.signal.aborted) setArts({ owner: userId, query, results: response.data?.items ?? [] }); })
            .catch(() => { if (!controller.signal.aborted) setArts({ owner: userId, query, results: [] }); });
        void requestBrowserJson<{ records?: RecordResult[] }>('/api/records?pageSize=8', { signal })
            .then(response => { if (!controller.signal.aborted) setRecords({ owner: userId, query, results: response.data?.records ?? [] }); })
            .catch(() => { if (!controller.signal.aborted) setRecords({ owner: userId, query, results: [] }); });
        return () => controller.abort();
    }, [open, query, userId]);
    useEffect(() => {
        if (!open || !query.trim() || !userId) return;
        const controller = new AbortController();
        const parsed = parseSearchTime(query);
        const keyword = parsed.keyword;
        const since = parsed.time?.since ?? '';
        const until = parsed.time?.until ?? '';
        const timeout = setTimeout(() => {
            const signal = withSearchTimeout(controller.signal);
            if (keyword) {
                void requestBrowserJson<{ results: Result[] }>(`/api/search?q=${encodeURIComponent(keyword)}`, { signal }).then(response => {
                    if (controller.signal.aborted) return;
                    setFailure({ owner: userId, query, message: response.error?.message ?? '' });
                    setResult({ owner: userId, query, results: response.data?.results ?? [] });
                }).catch(() => { if (!controller.signal.aborted) setFailure({ owner: userId, query, message: '搜索超时，请重试' }); });
            }
            // 占术历史与命理记录是补充结果：失败时不遮蔽对话结果。
            const artParams = new URLSearchParams({ q: keyword });
            if (since) { artParams.set('since', since); artParams.set('until', until); }
            void requestBrowserJson<{ items?: ArtResult[] }>(`/api/search/arts?${artParams}`, { signal }).then(response => {
                if (controller.signal.aborted) return;
                setArts({ owner: userId, query, results: response.data?.items ?? [] });
            }).catch(() => { if (!controller.signal.aborted) setArts({ owner: userId, query, results: [] }); });
            const recordParams = new URLSearchParams({ pageSize: '8' });
            if (keyword) recordParams.set('search', keyword);
            if (since) { recordParams.set('startDate', since); recordParams.set('endDate', until); }
            void requestBrowserJson<{ records?: RecordResult[] }>(`/api/records?${recordParams}`, { signal }).then(response => {
                if (controller.signal.aborted) return;
                setRecords({ owner: userId, query, results: response.data?.records ?? [] });
            }).catch(() => { if (!controller.signal.aborted) setRecords({ owner: userId, query, results: [] }); });
        }, 250);
        return () => { clearTimeout(timeout); controller.abort(); };
    }, [open, query, userId]);

    const parsed = useMemo(() => parseSearchTime(query), [query]);
    const keyword = parsed.keyword;
    const conversations = useMemo(() => result?.owner === userId && result.query === query ? result.results : [], [result, userId, query]);
    const recordResults = useMemo(() => records?.owner === userId && records.query === query ? records.results : [], [records, userId, query]);
    const artResults = useMemo(() => arts?.owner === userId && arts.query === query ? arts.results : [], [arts, userId, query]);
    const settingResults = useMemo(
        () => query.trim() ? matchSettingsSearchItems(keyword, settingsTabs) : recommendedSettingsSearchItems(settingsTabs),
        [query, keyword, settingsTabs],
    );
    const error = failure?.owner === userId && failure.query === query ? failure.message : '';
    const loading = !!query.trim() && !error
        && !(arts?.query === query || records?.query === query || (keyword && result?.query === query));
    const recentOnly = !query.trim();

    const entries = useMemo<Entry[]>(() => {
        const conversationEntries: Entry[] = filter === 'art' || filter === 'record' || filter === 'setting' ? [] : conversations.map(item => ({
            kind: 'conversation' as const, key: `${item.conversationId}:${item.messageId}`, title: item.title || '对话', preview: item.preview,
            icon: item.hasAgentRun ? <AgentIcon size={18} /> : <ChatIcon size={18} />, item,
        }));
        const recordEntries: Entry[] = filter === 'art' || filter === 'conversation' || filter === 'setting' ? [] : recordResults.map(item => ({
            kind: 'record' as const, key: item.id, title: item.title || '未命名记录', preview: recordPreview(item.content),
            tag: categoryLabel(item.category), icon: <RecordsIcon size={18} />, item,
        }));
        const artEntries: Entry[] = filter === 'conversation' || filter === 'record' || filter === 'setting' ? [] : artResults
            .filter(item => !featureTogglesLoaded || isFeatureEnabled(getDataSourceFeatureId(item.type)))
            .map(item => {
                const undated = item.type === 'bazi_chart' || item.type === 'ziwei_chart' || item.type === 'hepan_chart';
                return {
                    kind: 'art' as const, key: `${item.type}:${item.id}`, title: item.name,
                    // 占术入口不在搜索里重复出现；记录行只写卦象/名称与日期，副标题留问题、生日等额外信息。
                    preview: undated ? '' : artPreview(item.name, item.preview),
                    meta: undated ? undatedArtMeta(item) : resultDate(item.createdAt),
                    icon: TYPE_ICONS[item.type], item,
                };
            });
        const settingEntries: Entry[] = filter === 'art' || filter === 'conversation' || filter === 'record' ? [] : settingResults.map(item => {
            const Icon = (item.icon ? SETTINGS_SEARCH_ITEM_ICONS[item.icon] : undefined) ?? SETTINGS_CENTER_TAB_ICONS[item.tab];
            return {
                kind: 'setting' as const, key: `setting:${item.id}`, title: item.label, preview: item.description,
                icon: <Icon size={18} aria-hidden="true" />, item,
            };
        });
        return recentOnly
            ? [...conversationEntries, ...artEntries, ...recordEntries, ...settingEntries]
            : [...artEntries, ...conversationEntries, ...recordEntries, ...settingEntries];
    }, [filter, conversations, recordResults, artResults, settingResults, featureTogglesLoaded, isFeatureEnabled, recentOnly]);

    /** 已存占术记录先取回详情再跳转：结果页只认会话缓存，直接带 id 会被送回首页。 */
    const openArt = useCallback(async (item: ArtResult) => {
        if (!userId) return;
        const navId = getDataSourceNavId(item.type);
        if (navId === 'bazi' || navId === 'ziwei') {
            setOpen(false);
            router.push(`/${navId}/result?chart=${encodeURIComponent(item.id)}`);
            return;
        }
        if (!(HISTORY_TYPES as readonly string[]).includes(navId)) {
            setOpen(false);
            router.push(`/${navId}`);
            return;
        }
        try {
            const payload = await loadHistoryRestore(navId as HistoryType, item.id,
                Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai');
            if (!payload) throw new Error('这条记录已不存在');
            setOpen(false);
            router.push(applyHistoryRestorePayload(payload));
        } catch (error) {
            showToast('error', error instanceof Error ? error.message : '打开记录失败');
        }
    }, [router, showToast, userId]);
    const openEntry = useCallback((entry: Entry | undefined) => {
        if (!entry) return;
        if (entry.kind === 'art') { void openArt(entry.item); return; }
        setOpen(false);
        if (entry.kind === 'conversation') router.push(conversationHref({ id: entry.item.conversationId, hasAgentRun: entry.item.hasAgentRun }, entry.item.messageId));
        else if (entry.kind === 'record') router.push(`/records?id=${encodeURIComponent(entry.item.id)}`);
        else router.push(getSettingsCenterRouteTarget(entry.item.tab, {
            subpath: entry.item.subpath,
            search: `highlight=${encodeURIComponent(entry.item.anchor)}`,
        }));
    }, [openArt, router]);
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
        ? [
            { label: '最近使用', items: entries.filter(entry => entry.kind === 'conversation') },
            { label: '占术', items: entries.filter(entry => entry.kind === 'art') },
            { label: '记录', items: entries.filter(entry => entry.kind === 'record') },
            { label: '设置', items: entries.filter(entry => entry.kind === 'setting') },
        ].filter(group => group.items.length)
        : [
            { label: '占术', items: entries.filter(entry => entry.kind === 'art') },
            { label: '对话', items: entries.filter(entry => entry.kind === 'conversation') },
            { label: '记录', items: entries.filter(entry => entry.kind === 'record') },
            { label: '设置', items: entries.filter(entry => entry.kind === 'setting') },
        ].filter(group => group.items.length);

    const settled = result?.query === query || arts?.query === query || records?.query === query;
    const empty = !loading && !error && entries.length === 0 && (recentOnly || settled);

    return (
        <Dialog bare open={open} onClose={() => setOpen(false)} initialFocusRef={input} labelledBy="search-title" className="search-palette">
            <h2 id="search-title" className="sr-only">搜索</h2>
            <div className="search-palette-head">
                <Search size={20} aria-hidden="true" />
                <Input ref={input} value={query} maxLength={200} aria-label="搜索内容" placeholder="搜索"
                    onChange={event => { setQuery(event.target.value); setActive(0); }} />
                <Button unstyled type="button" className="search-palette-close" aria-label="关闭" onClick={() => setOpen(false)}>×</Button>
            </div>
            {parsed.time && <div className="search-palette-time">
                <span>时间：{parsed.time.label}</span>
                <Button unstyled type="button" aria-label="清除时间条件" onClick={() => { setQuery(keyword); setActive(0); }}>×</Button>
            </div>}
            <div className="search-palette-tabs" role="tablist" aria-label="搜索范围" onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')];
                const current = tabs.indexOf(document.activeElement as HTMLElement);
                if (current < 0) return;
                const next = event.key === 'Home' ? 0
                    : event.key === 'End' ? tabs.length - 1
                        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                event.preventDefault();
                event.stopPropagation();
                setFilter(FILTERS[next].value);
                setActive(0);
                tabs[next]?.focus();
            }}>
                {FILTERS.map(item => <Button unstyled key={item.value} type="button" role="tab" aria-selected={filter === item.value}
                    tabIndex={filter === item.value ? 0 : -1}
                    className="search-palette-tab" onClick={() => { setFilter(item.value); setActive(0); }}>{item.label}</Button>)}
            </div>
            <div ref={body} className="search-palette-body">
                {!userId ? <p className="search-palette-state">登录后搜索自己的对话。</p>
                    : error && !entries.length ? <p className="search-palette-state" role="alert">{error}</p>
                    : loading ? <p className="search-palette-state" role="status">正在搜索…</p>
                    : empty ? <p className="search-palette-state">{recentOnly ? '还没有可搜索的内容。' : '没有找到相关内容。'}</p>
                    : <>
                        {groups.map(group => <div key={group.label} className="search-palette-group-block">
                            <p className="search-palette-group">{group.label}</p>
                            {group.items.map(entry => {
                                const index = entries.indexOf(entry);
                                const isActive = index === active;
                                return <div key={entry.key} className="search-palette-row" data-active={isActive || undefined} onMouseEnter={() => setActive(index)}>
                                    <Button unstyled type="button" className="search-palette-item" onClick={() => openEntry(entry)}>
                                        <span className="search-palette-item-icon">{entry.icon}</span>
                                        <span className="search-palette-item-main">
                                            {/* strong 是验收脚本定位结果项的锚点；字重由 CSS 压回常规 */}
                                            <strong className="search-palette-item-title">{entry.title}
                                                {entry.kind === 'record' && <span className="search-palette-item-tag">{entry.tag}</span>}
                                                {entry.kind === 'art' && entry.meta && <span className="search-palette-item-meta">{entry.meta}</span>}
                                            </strong>
                                            {entry.preview && <span className="search-palette-item-preview">{entry.preview}</span>}
                                        </span>
                                    </Button>
                                    {isActive && <span className="search-palette-actions" aria-hidden="true">
                                        <span className="search-palette-action">↵</span>
                                    </span>}
                                </div>;
                            })}
                        </div>)}
                        {!recentOnly && <div className="search-palette-group-block">
                            <p className="search-palette-group">操作</p>
                            <div className="search-palette-row">
                                <Button unstyled type="button" className="search-palette-item" onClick={compose}>
                                    <span className="search-palette-item-icon"><Plus size={18} aria-hidden="true" /></span>
                                    <span className="search-palette-item-main"><strong className="search-palette-item-title">新建对话</strong>
                                        <span className="search-palette-item-preview">用「{query.trim()}」开始新对话</span></span>
                                </Button>
                            </div>
                        </div>}
                    </>}
            </div>
            <div className="search-palette-foot">
                <span className="search-palette-hint">关闭<kbd>Esc</kbd></span>
                <span className="search-palette-hint">筛选条件<kbd>/</kbd></span>
                <span className="search-palette-hint">打开<kbd>↵</kbd></span>
                <span className="search-palette-hint is-end">撰写<kbd>Tab</kbd></span>
            </div>
        </Dialog>
    );
}
