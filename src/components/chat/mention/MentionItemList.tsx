/**
 * MentionPopover 列表项渲染
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useEffect, useRef)
 * - 有鼠标交互和滚动行为
 */
'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { ChevronRight } from 'lucide-react';
import type { Mention } from '@/types';
import type {
    ViewItem, ViewModel, Level, MentionPopoverState,
    DataSourceSummary, KnowledgeBaseSummary,
} from '@/components/chat/mention/mention-constants';
import { isTypeItem, TYPE_ITEM_PREFIX, GROUP_ITEM_PREFIX } from '@/components/chat/mention/mention-constants';
import type { DataSourceType } from '@/lib/data-sources/types';

interface MentionItemListProps {
    view: ViewModel;
    activeLevel: Level;
    state: MentionPopoverState;
    loading: boolean;
    loadError: string | null;
    knowledgeBaseLocked: boolean;
    onActiveIndexChange: (index: number) => void;
    onNavigate: (nextState: MentionPopoverState) => void;
    onSelect: (mention: Mention) => void;
    onClose: () => void;
}

export function MentionItemList({
    view,
    activeLevel,
    state,
    loading,
    loadError,
    knowledgeBaseLocked,
    onActiveIndexChange,
    onNavigate,
    onSelect,
    onClose,
}: MentionItemListProps) {
    const listRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const active = list.querySelector<HTMLElement>('[data-active="true"]');
        if (!active) return;
        active.scrollIntoView({ block: 'nearest' });
    }, [state.activeIndex, view.items]);

    const handleItemClick = (item: ViewItem) => {
        if (item.disabled) return;

        if ((activeLevel === 'root' || activeLevel === 'types') && isTypeItem(item)) {
            onNavigate({
                level: 'item', selectedCategory: 'data',
                selectedType: item.key.slice(TYPE_ITEM_PREFIX.length) as DataSourceType,
                parent: activeLevel === 'types' ? 'types' : 'root',
                activeIndex: 0,
            });
            return;
        }

        if (activeLevel === 'root' && item.key.startsWith(GROUP_ITEM_PREFIX)) {
            onNavigate({ level: 'types', activeIndex: 0 });
            return;
        }

        selectRawItem(item);
    };

    const selectRawItem = (item: ViewItem) => {
        const raw = item.raw;
        if (!raw) return;
        if ('type' in raw) {
            onSelect({ type: (raw as DataSourceSummary).type, id: raw.id, name: raw.name, preview: (raw as DataSourceSummary).preview });
            onClose();
            return;
        }
        if (knowledgeBaseLocked) return;
        onSelect({ type: 'knowledge_base', id: raw.id, name: raw.name, preview: (raw as KnowledgeBaseSummary).description || '知识库' });
        onClose();
    };

    const emptyMessage = loadError
        ? loadError
        : activeLevel === 'item' && state.selectedCategory === 'knowledge'
            ? (knowledgeBaseLocked ? '知识库已关闭' : '你还没有知识库')
            : activeLevel === 'item' && state.selectedCategory === 'data'
                ? '该分类暂无数据'
                : activeLevel === 'root' || activeLevel === 'types'
                    ? '还没有可提及的内容'
                    : '没有匹配项';

    return (
        <div ref={listRef} className="chat-mention-list">
            {loading ? (
                <div className="chat-mention-loading">
                    {[1, 2, 3].map(i => (
                        <div key={i}>
                            <span />
                            <span />
                        </div>
                    ))}
                </div>
            ) : view.items.length === 0 ? (
                <div className="chat-mention-state">
                    {emptyMessage}
                </div>
            ) : (
                view.items.map((item, idx) => (
                    <Button unstyled
                        key={item.key}
                        type="button"
                        disabled={item.disabled}
                        data-active={idx === state.activeIndex ? 'true' : 'false'}
                        className="chat-mention-item"
                        onMouseEnter={() => onActiveIndexChange(idx)}
                        onClick={() => handleItemClick(item)}
                    >
                        <span className="chat-mention-item-icon">{item.icon}</span>
                        <span className="chat-mention-item-body">
                            <span className="chat-mention-item-label">{item.label}</span>
                        </span>
                        {!!item.hint && <span className="chat-mention-item-hint">{item.hint}</span>}                        {(activeLevel === 'root' || activeLevel === 'types') && (isTypeItem(item) || item.key.startsWith(GROUP_ITEM_PREFIX)) && <ChevronRight className="w-4 h-4 chat-mention-item-tail" />}
                    </Button>
                ))
            )}
        </div>
    );
}
