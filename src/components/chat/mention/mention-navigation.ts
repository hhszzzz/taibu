import type { DataSourceType } from '@/lib/data-sources/types';

export type MentionNavigationLevel = 'root' | 'types' | 'item' | 'search';

export interface MentionNavigationState {
    level: MentionNavigationLevel;
    selectedCategory?: 'data' | 'knowledge';
    selectedType?: DataSourceType;
    /** Where an item-level list was opened from; absent when it is the locked knowledge view. */
    parent?: 'root' | 'types';
    activeIndex: number;
}

interface MentionNavigationOptions {
    defaultCategory?: 'knowledge' | 'data';
    knowledgeBaseLocked?: boolean;
}

export function getInitialMentionNavigationState({
    defaultCategory,
    knowledgeBaseLocked = false,
}: MentionNavigationOptions): MentionNavigationState {
    if (knowledgeBaseLocked || defaultCategory === 'knowledge') {
        return { level: 'item', selectedCategory: 'knowledge', activeIndex: 0 };
    }
    return { level: 'root', activeIndex: 0 };
}

export function getBackNavigationState(
    state: MentionNavigationState,
    { knowledgeBaseLocked = false }: Pick<MentionNavigationOptions, 'knowledgeBaseLocked'> = {}
): MentionNavigationState | null {
    if (state.level === 'types') return { level: 'root', activeIndex: 0 };
    if (state.level !== 'item') return null;
    if (state.parent === 'types') return { level: 'types', activeIndex: 0 };
    if (state.parent === 'root') return { level: 'root', activeIndex: 0 };
    return knowledgeBaseLocked ? null : { level: 'root', activeIndex: 0 };
}
