import type { LiuYueInfo } from '@/lib/divination/bazi';
import { ganZhiTextClass } from '@/components/bazi/element-classes';

export function LiuYueTable({
    liuYue,
    selectedMonth,
    onSelect,
}: {
    liuYue: LiuYueInfo[];
    selectedMonth: number;
    onSelect: (month: number) => void;
}) {
    return (
        <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-hide sm:mx-0 sm:px-0">
            <div className="flex gap-1.5">
                {liuYue.map((ly, index) => {
                    const isSelected = ly.month === selectedMonth;
                    const [, startMonth, startDay] = ly.startDate.split('-');

                    return (
                        <button
                            key={index}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => onSelect(ly.month)}
                            className={`flex min-w-[60px] flex-1 shrink-0 flex-col items-center gap-0.5 rounded-[10px] px-1 py-2 transition-colors duration-150
                                ${isSelected
                                    ? 'bg-accent-light ring-[1.5px] ring-inset ring-accent'
                                    : 'border-[0.5px] border-border bg-surface hover:bg-background-secondary'
                                }`}
                        >
                            <span className={`truncate text-xs ${isSelected ? 'text-accent-strong' : 'text-foreground-secondary'}`}>{ly.jieQi}</span>
                            <span className="text-[11px] leading-none text-foreground-tertiary tabular-nums">
                                {Number(startMonth)}/{Number(startDay)}
                            </span>
                            <span className="mt-1 font-display text-base leading-[1.3]">
                                <span className={ganZhiTextClass(ly.gan)}>{ly.gan}</span>
                                <span className={ganZhiTextClass(ly.zhi)}>{ly.zhi}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
