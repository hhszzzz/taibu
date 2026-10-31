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
    type ViewModel, type MentionPopoverState, type Level,
    TYPE_LABELS, TYPE_ICONS,
    HEPAN_TYPE_LABELS, HEPAN_TYPE_ICONS,
    FOLDER_ICON, KB_ICON, CHEVRON_ICON,
    getHepanSubtype, shouldShowHint,
    normalizeQuery, getQueryHint,
} from '@/components/chat/mention/mention-constants';
import {
    getBackNavigationState,
    getInitialMentionNavigationState,
} from '@/components/chat/mention/mention-navigation';
import {
    getVisibleDataSubcategories,
    getVisibleDataTypesForSubcategory,
} from '@/components/chat/mention/mention-visibility';
import { DATA_SUBCATEGORY_MAP, DATA_SUBCATEGORY_DIVIDE } from '@/components/chat/mention/mention-data-catalog';
import { MentionHeader } from '@/components/chat/mention/MentionHeader';
import { MentionItemList } from '@/components/chat/mention/MentionItemList';
import type { DataSourceType } from '@/lib/data-sources/types';

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
    const normalizedQuery = useMemo(() => normalizeQuery(query), [query]);
    const queryHint = useMemo(() => getQueryHint(query), [query]);
    const visibleSubcategories = useMemo(
        () => getVisibleDataSubcategories(enabledDataSourceTypes),
        [enabledDataSourceTypes]
    );

    const effectiveState = useMemo<MentionPopoverState>(() => {
        if (!queryHint || normalizedQuery) return state;
        if (queryHint === 'data') {
            return { ...state, level: 'subcategory', selectedCategory: 'data', selectedSubcategory: undefined, activeIndex: 0 };
        }
        if (queryHint === 'knowledge') {
            return { ...state, level: 'item', selectedCategory: 'knowledge', selectedSubcategory: undefined, activeIndex: 0 };
        }
        return state;
    }, [queryHint, normalizedQuery, state]);

    const activeLevel: Level = normalizedQuery ? 'search' : effectiveState.level;

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

    const hepanTypeCounts = useMemo(() => {
        const counts: Record<string, number> = { love: 0, business: 0, family: 0 };
        dataSources.filter(item => item.type === 'hepan_chart').forEach(item => {
            const key = getHepanSubtype(item);
            if (!key) return;
            counts[key] = (counts[key] || 0) + 1;
        });
        return counts;
    }, [dataSources]);

    // ---- View model ----

    const view = useMemo((): ViewModel => {
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

        if (activeLevel === 'category') {
            return {
                title: '选择类别',
                items: [
                    { key: 'data', label: '@数据', hint: dataSourceErrors.length ? `部分来源失败（${dataSourceErrors.length}）` : '命盘/记录/运势', icon: FOLDER_ICON },
                    { key: 'knowledge', label: '@知识库', hint: knowledgeBaseLocked ? '知识库已关闭' : '你的知识库', icon: KB_ICON, disabled: knowledgeBaseLocked },
                ],
            };
        }

        if (activeLevel === 'subcategory' && effectiveState.selectedCategory === 'data') {
            return {
                title: '@数据',
                items: visibleSubcategories.map((s) => ({ key: s, label: s, icon: FOLDER_ICON })),
            };
        }

        if (activeLevel === 'type' && effectiveState.selectedCategory === 'data') {
            const sub = effectiveState.selectedSubcategory || '命盘';
            if (sub === '合盘记录') {
                const items = Object.keys(HEPAN_TYPE_LABELS).map(key => ({
                    key: `hepan:${key}`,
                    label: HEPAN_TYPE_LABELS[key],
                    hint: `${hepanTypeCounts[key] || 0} 条`,
                    icon: HEPAN_TYPE_ICONS[key],
                }));
                return { title: `@数据 / ${sub}`, items };
            }
            const allowed = getVisibleDataTypesForSubcategory(sub, enabledDataSourceTypes);
            return {
                title: `@数据 / ${sub}`,
                items: allowed.map((t) => ({
                    key: t,
                    label: TYPE_LABELS[t],
                    hint: `${typeCounts.get(t) || 0} 条`,
                    icon: TYPE_ICONS[t],
                })),
            };
        }

        if (activeLevel === 'item' && effectiveState.selectedCategory === 'data') {
            const sub = effectiveState.selectedSubcategory || '命盘';
            const selectedType = effectiveState.selectedType;
            let items = filteredDataSources;
            if (selectedType) {
                if (selectedType.startsWith('hepan:')) {
                    const typeKey = selectedType.replace('hepan:', '');
                    items = items.filter(i => i.type === 'hepan_chart' && i.hepanType === typeKey);
                } else {
                    items = items.filter(i => i.type === selectedType);
                }
            } else {
                const allowed = new Set(DATA_SUBCATEGORY_MAP[sub] || []);
                items = items.filter(i => allowed.has(i.type));
            }
            return {
                title: `@数据 / ${sub}`,
                items: items.map((i) => ({
                    key: i.id,
                    label: i.name,
                    hint: shouldShowHint(i) ? i.preview : '',
                    icon: TYPE_ICONS[i.type],
                    raw: i,
                })),
            };
        }

        return {
            title: '@知识库',
            items: knowledgeBaseLocked
                ? [{ key: 'kb-locked', label: '知识库', hint: '知识库已关闭', icon: KB_ICON, disabled: true }]
                : filteredKnowledgeBases.map((kb) => ({ key: kb.id, label: kb.name, hint: kb.description || '知识库', icon: CHEVRON_ICON, raw: kb })),
        };
    }, [activeLevel, dataSourceErrors.length, effectiveState.selectedCategory, effectiveState.selectedSubcategory, effectiveState.selectedType, enabledDataSourceTypes, filteredDataSources, filteredKnowledgeBases, hepanTypeCounts, knowledgeBaseLocked, typeCounts, visibleSubcategories]);

    // ---- Keyboard navigation ----

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (activeLevel === 'category' || activeLevel === 'search') onClose();
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
                handleArrowRight();
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                handleEnter();
            }
        };

        const handleArrowRight = () => {
            if (activeLevel === 'category') {
                const key = view.items[effectiveState.activeIndex]?.key;
                if (key === 'data') {
                    setState({ level: 'subcategory', selectedCategory: 'data', activeIndex: 0 });
                } else if (key === 'knowledge' && !knowledgeBaseLocked) {
                    setState({ level: 'item', selectedCategory: 'knowledge', activeIndex: 0 });
                }
            } else if (activeLevel === 'subcategory') {
                const sub = view.items[effectiveState.activeIndex]?.key;
                if (sub) {
                    if (DATA_SUBCATEGORY_DIVIDE.has(sub)) {
                        setState({ level: 'type', selectedCategory: 'data', selectedSubcategory: sub, activeIndex: 0 });
                    } else {
                        setState({ level: 'item', selectedCategory: 'data', selectedSubcategory: sub, activeIndex: 0 });
                    }
                }
            } else if (activeLevel === 'type') {
                const nextType = view.items[effectiveState.activeIndex]?.key;
                if (nextType) {
                    setState({ level: 'item', selectedCategory: 'data', selectedSubcategory: effectiveState.selectedSubcategory, selectedType: nextType, activeIndex: 0 });
                }
            }
        };

        const handleEnter = () => {
            const item = view.items[effectiveState.activeIndex];
            if (!item) return;
            if (activeLevel === 'search') {
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
                return;
            }
            if (activeLevel === 'category') {
                if (item.key === 'data') setState({ level: 'subcategory', selectedCategory: 'data', activeIndex: 0 });
                else if (!item.disabled) setState({ level: 'item', selectedCategory: 'knowledge', activeIndex: 0 });
                return;
            }
            if (activeLevel === 'subcategory' && effectiveState.selectedCategory === 'data') {
                if (DATA_SUBCATEGORY_DIVIDE.has(item.key)) {
                    setState({ level: 'type', selectedCategory: 'data', selectedSubcategory: item.key, activeIndex: 0 });
                } else {
                    setState({ level: 'item', selectedCategory: 'data', selectedSubcategory: item.key, activeIndex: 0 });
                }
                return;
            }
            if (activeLevel === 'type' && effectiveState.selectedCategory === 'data') {
                setState({ level: 'item', selectedCategory: 'data', selectedSubcategory: effectiveState.selectedSubcategory, selectedType: item.key, activeIndex: 0 });
                return;
            }
            if (activeLevel === 'item' && effectiveState.selectedCategory === 'data') {
                const raw = item.raw;
                if (!raw || !('type' in raw)) return;
                onSelect({ type: raw.type, id: raw.id, name: raw.name, preview: raw.preview });
                onClose();
                return;
            }
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

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [activeLevel, goBack, knowledgeBaseLocked, onClose, onSelect, effectiveState.activeIndex, effectiveState.selectedCategory, effectiveState.selectedSubcategory, view.items]);

    return (
        <div className="absolute bottom-full mb-2 z-40 left-2 right-2 md:left-0 md:right-auto md:w-[min(576px,100%)]">
            <div className="chat-mention-popover">
                <MentionHeader
                    title={view.title}
                    activeLevel={activeLevel}
                    loadError={loadError}
                    dataSourceErrors={dataSourceErrors}
                    onGoBack={goBack}
                />
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
