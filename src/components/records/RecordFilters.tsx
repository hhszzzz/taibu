/**
 * 记录搜索与分类筛选
 *
 * 'use client' 标记说明：
 * - 使用受控输入（onChange）与分类按钮点击
 */
'use client';

import { Search } from 'lucide-react';
import { RecordCategory, RECORD_CATEGORIES } from '@/lib/records';

interface RecordFiltersProps {
    search: string;
    onSearchChange: (value: string) => void;
    category: RecordCategory | '';
    onCategoryChange: (value: RecordCategory | '') => void;
}

const CATEGORY_OPTIONS: { value: RecordCategory | ''; label: string }[] = [
    { value: '', label: '全部' },
    ...RECORD_CATEGORIES.map(({ value, label }) => ({ value, label })),
];

/** 胶囊筛选按钮，选中态用 aria-pressed 表达。 */
export const RECORD_CHIP_CLASS = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border-[0.5px] border-border-hover bg-surface px-3 text-[13px] text-foreground-secondary transition-colors hover:text-foreground aria-pressed:border-transparent aria-pressed:bg-foreground aria-pressed:text-background';

export function RecordFilters({
    search,
    onSearchChange,
    category,
    onCategoryChange,
}: RecordFiltersProps) {
    return (
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <label className="relative block md:flex-1">
                <span className="sr-only">搜索记录</span>
                <Search className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-foreground-tertiary" aria-hidden="true" />
                <input
                    type="search"
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="搜索标题、内容或标签"
                    className="h-11 w-full rounded-[10px] border-[0.5px] border-border-hover bg-surface pr-3.5 pl-[42px] text-[15px] text-foreground placeholder:text-foreground-tertiary focus:border-accent focus:outline-none"
                />
            </label>
            {/* 手机上分类横向滚动，不换行挤压。 */}
            <div role="group" aria-label="分类" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 md:mx-0 md:overflow-visible md:px-0 md:pb-0">
                {CATEGORY_OPTIONS.map(option => (
                    <button
                        key={option.value || 'all'}
                        type="button"
                        aria-pressed={category === option.value}
                        onClick={() => onCategoryChange(option.value)}
                        className={RECORD_CHIP_CLASS}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
