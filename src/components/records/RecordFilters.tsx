/**
 * 记录筛选：分类分段控件、搜索框与可取消的标签筛选。
 */
'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { RecordCategory, RECORD_CATEGORIES } from '@/lib/records';
import { IconButton } from '@/components/ui/IconButton';
import { FilterChip } from '@/components/ui/FilterChip';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

export type RecordsCategoryFilter = RecordCategory | 'all';

const CATEGORY_SHORT: Record<RecordCategory, string> = { general: '通用', prediction: '预测', event: '事件', reflection: '心得' };
const CATEGORY_OPTIONS: { value: RecordsCategoryFilter; label: string }[] = [
    { value: 'all', label: '全部' },
    ...RECORD_CATEGORIES.map(({ value }) => ({ value, label: CATEGORY_SHORT[value] })),
];

const SEARCH_INPUT_CLASS = 'h-10 rounded-xl pr-3 pl-9 text-sm';

export function RecordFilters({
    search,
    onSearchChange,
    category,
    onCategoryChange,
    tag,
    onTagChange,
}: {
    search: string;
    onSearchChange: (value: string) => void;
    category: RecordsCategoryFilter;
    onCategoryChange: (value: RecordsCategoryFilter) => void;
    tag: string | null;
    onTagChange: (value: string | null) => void;
}) {
    const [searchOpen, setSearchOpen] = useState(false);
    const showMobileSearch = searchOpen || !!search;
    const searchField = (autoFocus: boolean) => (
        <label className="relative block">
            <span className="sr-only">搜索记录</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-foreground-tertiary" aria-hidden="true" />
            <Input type="search" autoFocus={autoFocus} value={search} onChange={(event) => onSearchChange(event.target.value)}
                placeholder="搜索标题、内容或标签" className={SEARCH_INPUT_CLASS} />
        </label>
    );

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <SegmentedControl<RecordsCategoryFilter> ariaLabel="分类" size="sm" value={category} onChange={onCategoryChange}
                    options={CATEGORY_OPTIONS} className="min-w-0 flex-1 md:max-w-[24rem]" />
                <div className="hidden flex-1 md:block">{searchField(false)}</div>
                <IconButton label="搜索" aria-pressed={showMobileSearch} onClick={() => setSearchOpen(open => !open)}
                    className="h-10 w-10 rounded-xl md:hidden">
                    <Search aria-hidden="true" />
                </IconButton>
            </div>
            {showMobileSearch ? <div className="md:hidden">{searchField(false)}</div> : null}
            {tag ? (
                <div className="flex items-center gap-2 text-[13px] text-foreground-tertiary">
                    按标签
                    <FilterChip pressed onClick={() => onTagChange(null)} aria-label={`取消标签筛选「${tag}」`} className="h-7 pr-2 pl-2.5">
                        #{tag}<X className="h-3.5 w-3.5" aria-hidden="true" />
                    </FilterChip>
                </div>
            ) : null}
        </div>
    );
}
