'use client';

/**
 * 表格底部的翻页：上一页 / 第 N 页 / 下一页，可以换每页条数。
 * 只有「还有没有下一页」这一信息，没有总页数，所以页码只是当前页。
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';

export function TablePagination({ page, pageSize, hasNext, loading = false, onPage, onPageSize, sizes = [20, 50, 100] }: {
    /** 1-based. */
    page: number;
    pageSize: number;
    hasNext: boolean;
    loading?: boolean;
    onPage: (page: number) => void;
    onPageSize?: (size: number) => void;
    sizes?: readonly number[];
}) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-foreground-secondary">
            <div className="flex items-center gap-2">
                {onPageSize ? (
                    <>
                        <span>每页</span>
                        <Select ariaLabel="每页条数" value={pageSize} options={sizes.map(size => ({ value: size, label: String(size) }))}
                            onChange={onPageSize} className="h-8 w-20 rounded-lg" />
                        <span>条</span>
                    </>
                ) : null}
            </div>
            <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>
                    <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />上一页
                </Button>
                <span className="tabular-nums">第 {page} 页</span>
                <Button variant="secondary" size="sm" disabled={loading || !hasNext} onClick={() => onPage(page + 1)}>
                    下一页<ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
}
