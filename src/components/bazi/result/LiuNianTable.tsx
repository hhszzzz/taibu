import type { LiuNianInfo } from '@/lib/divination/bazi';
import { ganZhiTextClass } from '@/components/bazi/element-classes';

/**
 * 流年条：连成一体的分格卡片，选中年份以深色块突出，今年加「今年」标记。
 */
export function LiuNianTable({
    liuNian,
    selectedYear,
    onSelect,
}: {
    liuNian: LiuNianInfo[];
    selectedYear: number;
    onSelect: (year: number) => void;
}) {
    const thisYear = new Date().getFullYear();
    return (
        <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-hide sm:mx-0 sm:px-0">
            <div className="flex min-w-full overflow-hidden rounded-xl border-[0.5px] border-border bg-surface">
                {liuNian.map((ln, index) => {
                    const isSelected = selectedYear === ln.year;
                    const isThisYear = ln.year === thisYear;
                    return (
                        <button
                            key={index}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => onSelect(ln.year)}
                            className={`flex min-w-[76px] flex-1 flex-col items-center gap-0.5 px-1 py-2.5 transition-colors duration-150
                                ${index > 0 ? 'border-l-[0.5px] border-border' : ''}
                                ${isSelected ? 'bg-foreground text-background' : 'hover:bg-background-secondary'}`}
                        >
                            <span className={`whitespace-nowrap text-xs ${isSelected ? 'text-background/80' : 'text-foreground-secondary'}`}>
                                {ln.year}{isThisYear ? ' · 今年' : ''}
                            </span>
                            <span className="font-display text-lg leading-[1.3]">
                                <span className={isSelected ? '' : ganZhiTextClass(ln.gan)}>{ln.gan}</span>
                                <span className={isSelected ? '' : ganZhiTextClass(ln.zhi)}>{ln.zhi}</span>
                            </span>
                            <span className={`whitespace-nowrap text-xs ${isSelected ? 'text-background/80' : 'text-foreground-secondary'}`}>
                                {ln.tenGod}
                                <span className={`ml-1 ${isSelected ? 'text-background/60' : 'text-foreground-tertiary'}`}>{ln.age}岁</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
