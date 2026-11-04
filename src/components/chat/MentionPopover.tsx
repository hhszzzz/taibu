/**
 * @mention 弹出选择器组件（主壳）
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useState, useEffect, useMemo)
 * - 有键盘导航和交互功能
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenText } from 'lucide-react';
import type { Mention } from '@/types';
import {
    type DataSourceSummary, type DataSourceLoadError, type KnowledgeBaseSummary,
    type ViewItem, type ViewModel, type MentionPopoverState, type Level,
    TYPE_LABELS, TYPE_ICONS, KB_ICON, GROUP_ICON,
    isTypeItem, shouldShowHint, TYPE_ITEM_PREFIX, GROUP_ITEM_PREFIX,
    normalizeQuery, getQueryHint,
} from '@/components/chat/mention/mention-constants';
import {
    getBackNavigationState,
    getInitialMentionNavigationState,
} from '@/components/chat/mention/mention-navigation';
import { MentionHeader } from '@/components/chat/mention/MentionHeader';
import { MentionItemList } from '@/components/chat/mention/MentionItemList';
import { getDataSourceNavId } from '@/lib/data-sources/catalog';
import type { DataSourceType } from '@/lib/data-sources/types';
import { useSidebarPins } from '@/lib/navigation/sidebar-pins';

/** Divination records in sidebar order; daily and monthly fortunes are mentioned directly instead. */
const ROOT_METHOD_TYPES: DataSourceType[] = [
    'bazi_chart', 'hepan_chart', 'ziwei_chart', 'tarot_reading', 'liuyao_divination', 'qimen_chart',
    'daliuren_divination', 'meihua_divination', 'xiaoliuren_divination', 'face_reading', 'palm_reading', 'mbti_reading',
];
const ROOT_FORTUNE_TYPES: DataSourceType[] = ['daily_fortune', 'monthly_fortune'];
/** Always first level, even when unpinned: the user reads charts from here most often. */
const ALWAYS_FIRST: ReadonlySet<DataSourceType> = new Set(['bazi_chart', 'ziwei_chart']);
const RECORDS_GROUP = `${GROUP_ITEM_PREFIX}records`;

/** 「今日运势（2026-11-04）」 reads as just the date: the row already names the fortune. */
const fortuneDate = (name: string) => /[（(]([^）)]+)[）)]/.exec(name)?.[1] ?? '';

interface MentionPopoverProps {
    query: string;
    dataSources: DataSourceSummary[];
    knowledgeBases: KnowledgeBaseSummary[];
    enabledDataSourceTypes: DataSourceType[];
    loadError?: string | null;
    dataSourceErrors?: DataSourceLoadError[];
    loading?: boolean;
    defaultCategory?: 'knowledge' | 'data';
    knowledgeBaseLocked?: boolean;
    onSelect: (mention: Mention) => void;
    onClose: () => void;
}

export function MentionPopover({ query, dataSources, knowledgeBases, enabledDataSourceTypes, loadError = null, dataSourceErrors = [], loading = false, defaultCategory, knowledgeBaseLocked = false, onSelect, onClose }: MentionPopoverProps) {
    const [state, setState] = useState<MentionPopoverState>(() => getInitialMentionNavigationState({ defaultCategory, knowledgeBaseLocked }));
    const { pins } = useSidebarPins();
    const normalizedQuery = useMemo(() => normalizeQuery(query), [query]);
    const queryHint = useMemo(() => getQueryHint(query), [query]);

    const effectiveState = useMemo<MentionPopoverState>(() => {
        if (!queryHint || normalizedQuery) return state;
        if (queryHint === 'data') {
            return { level: 'root', activeIndex: 0 };
        }
        return { level: 'item', selectedCategory: 'knowledge', activeIndex: 0 };
    }, [queryHint, normalizedQuery, state]);

    const activeLevel: Level = normalizedQuery ? 'search' : effectiveState.level;
    /** Root reads as a plain list like the slash menu; sub levels keep the back row (and its title). */
    const showBack = activeLevel === 'types' || (activeLevel === 'item' && !knowledgeBaseLocked);

    // ---- Navigation ----

    const goBack = useCallback(() => {
        const nextState = getBackNavigationState(state, { knowledgeBaseLocked });
        if (!nextState) {
            onClose();
            return;
        }
        setState(nextState);
    }, [knowledgeBaseLocked, onClose, state]);

    // ---- Filtered data ----

    const filteredDataSources = useMemo(() => {
        if (!normalizedQuery) return dataSources;
        return dataSources.filter(item =>
            item.name.toLowerCase().includes(normalizedQuery) ||
            (item.preview || '').toLowerCase().includes(normalizedQuery)
        );
    }, [dataSources, normalizedQuery]);

    const filteredKnowledgeBases = useMemo(() => {
        if (!normalizedQuery) return knowledgeBases;
        return knowledgeBases.filter(kb =>
            kb.name.toLowerCase().includes(normalizedQuery) ||
            (kb.description || '').toLowerCase().includes(normalizedQuery)
        );
    }, [knowledgeBases, normalizedQuery]);

    const typeCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const item of dataSources) {
            counts.set(item.type, (counts.get(item.type) || 0) + 1);
        }
        return counts;
    }, [dataSources]);

    const typeRows = useMemo(() => {
        const enabled = new Set(enabledDataSourceTypes);
        const pinned = new Set(pins);
        const atRoot = ROOT_METHOD_TYPES.filter(type => enabled.has(type) && (ALWAYS_FIRST.has(type) || pinned.has(getDataSourceNavId(type))));
        const inRecords = ROOT_METHOD_TYPES.filter(type => enabled.has(type) && !atRoot.includes(type));
        return { atRoot, inRecords };
    }, [enabledDataSourceTypes, pins]);

    // ---- View model ----

    const view = useMemo((): ViewModel => {
        const enabled = new Set(enabledDataSourceTypes);
        const typeRow = (type: DataSourceType): ViewItem => ({
            key: `${TYPE_ITEM_PREFIX}${type}`,
            label: TYPE_LABELS[type],
            hint: `${typeCounts.get(type) || 0} 条`,
            icon: TYPE_ICONS[type],
        });

        if (activeLevel === 'search') {
            const dataItems = filteredDataSources.map((i) => ({
                key: `data-${i.id}`,
                label: `@${TYPE_LABELS[i.type] || '数据'} · ${i.name}`,
                hint: shouldShowHint(i) ? i.preview : '',
                icon: TYPE_ICONS[i.type],
                raw: i,
            }));
            const kbItems = knowledgeBaseLocked
                ? []
                : filteredKnowledgeBases.map((kb) => ({
                    key: `kb-${kb.id}`,
                    label: `@知识库 · ${kb.name}`,
                    hint: kb.description || '知识库',
                    icon: <BookOpenText className="w-4 h-4" />,
                    raw: kb,
                }));
            return { title: '搜索结果', items: [...dataItems, ...kbItems] };
        }

        if (activeLevel === 'root') {
            const items: ViewItem[] = typeRows.atRoot.map(typeRow);
            for (const type of ROOT_FORTUNE_TYPES) {
                if (!enabled.has(type)) continue;
                for (const item of filteredDataSources.filter(source => source.type === type)) {
                    items.push({ key: `data-${item.id}`, label: TYPE_LABELS[type], hint: fortuneDate(item.name), icon: TYPE_ICONS[type], raw: item });
                }
            }
            if (enabled.has('ming_record')) items.push(typeRow('ming_record'));
            if (!knowledgeBaseLocked) {
                items.push(...filteredKnowledgeBases.map((kb) => ({
                    key: `kb-${kb.id}`, label: kb.name, hint: kb.description || '知识库', icon: KB_ICON, raw: kb,
                })));
                if (!filteredKnowledgeBases.length) {
                    items.push({ key: 'kb-empty', label: '知识库', hint: '还没有知识库', icon: KB_ICON, disabled: true });
                }
            }
            if (typeRows.inRecords.length) {
                const count = typeRows.inRecords.reduce((sum, type) => sum + (typeCounts.get(type) || 0), 0);
                items.push({ key: RECORDS_GROUP, label: '更多', hint: `${count} 条`, icon: GROUP_ICON });
            }
            return { title: '@提及', items };
        }

        if (activeLevel === 'types') {
            return { title: '更多', items: typeRows.inRecords.map(typeRow) };
        }

        if (effectiveState.selectedCategory === 'knowledge') {
            return {
                title: '@知识库',
                items: knowledgeBaseLocked
                    ? [{ key: 'kb-locked', label: '知识库', hint: '知识库已关闭', icon: KB_ICON, disabled: true }]
                    : filteredKnowledgeBases.map((kb) => ({ key: kb.id, label: kb.name, hint: kb.description || '知识库', icon: KB_ICON, raw: kb })),
            };
        }

        const type = effectiveState.selectedType;
        const items = filteredDataSources.filter(item => !type || item.type === type);
        return {
            title: type ? TYPE_LABELS[type] : '@提及',
            items: items.map((i) => ({
                key: i.id,
                label: i.name,
                hint: shouldShowHint(i) ? i.preview : '',
                icon: TYPE_ICONS[i.type],
                raw: i,
            })),
        };
    }, [activeLevel, effectiveState.selectedCategory, effectiveState.selectedType, enabledDataSourceTypes, filteredDataSources, filteredKnowledgeBases, knowledgeBaseLocked, typeCounts, typeRows]);

    // ---- Keyboard navigation ----

    useEffect(() => {
        const selectRawItem = (item: ViewItem) => {
            const raw = item.raw;
            if (!raw) return;
            if ('type' in raw) {
                onSelect({ type: raw.type, id: raw.id, name: raw.name, preview: raw.preview });
                onClose();
                return;
            }
            if (knowledgeBaseLocked) return;
            onSelect({ type: 'knowledge_base', id: raw.id, name: raw.name, preview: raw.description || '知识库' });
            onClose();
        };

        const openRow = (item: ViewItem) => {
            if (isTypeItem(item)) {
                setState({
                    level: 'item', selectedCategory: 'data',
                    selectedType: item.key.slice(TYPE_ITEM_PREFIX.length) as DataSourceType,
                    parent: activeLevel === 'types' ? 'types' : 'root',
                    activeIndex: 0,
                });
                return true;
            }
            if (item.key.startsWith(GROUP_ITEM_PREFIX)) {
                setState({ level: 'types', activeIndex: 0 });
                return true;
            }
            return false;
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (activeLevel === 'root' || activeLevel === 'search') onClose();
                else goBack();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setState(prev => ({ ...prev, activeIndex: Math.min(prev.activeIndex + 1, view.items.length - 1) }));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setState(prev => ({ ...prev, activeIndex: Math.max(prev.activeIndex - 1, 0) }));
                return;
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                goBack();
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                const item = view.items[effectiveState.activeIndex];
                if (item && (activeLevel === 'root' || activeLevel === 'types')) openRow(item);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const item = view.items[effectiveState.activeIndex];
                if (!item || item.disabled) return;
                if ((activeLevel === 'root' || activeLevel === 'types') && openRow(item)) return;
                selectRawItem(item);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [activeLevel, goBack, knowledgeBaseLocked, onClose, onSelect, effectiveState.activeIndex, view.items]);

    return (
        <div className="absolute bottom-full mb-2 z-40 left-2 right-2 md:left-0 md:right-auto md:w-[min(576px,100%)]">
            <div className="chat-mention-popover">
                {showBack && (
                    <MentionHeader
                        title={view.title}
                        showBack={showBack}
                        onGoBack={goBack}
                    />
                )}
                {!!loadError && <div className="chat-mention-alert is-error">{loadError}</div>}
                {!loadError && dataSourceErrors.length > 0 && (
                    <div className="chat-mention-alert is-warning">
                        数据源加载部分失败：{dataSourceErrors.slice(0, 2).map(e => e.type).join('、')}{dataSourceErrors.length > 2 ? '…' : ''}
                    </div>
                )}
                <MentionItemList
                    view={view}
                    activeLevel={activeLevel}
                    state={state}
                    loading={loading}
                    loadError={loadError}
                    knowledgeBaseLocked={knowledgeBaseLocked}
                    onActiveIndexChange={(idx) => setState(prev => ({ ...prev, activeIndex: idx }))}
                    onNavigate={(next) => setState(next)}
                    onSelect={onSelect}
                    onClose={onClose}
                />
            </div>
        </div>
    );
}
