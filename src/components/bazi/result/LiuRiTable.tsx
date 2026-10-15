import type { LiuRiInfo } from '@/lib/divination/bazi';
import { ganZhiTextClass } from '@/components/bazi/element-classes';

export function LiuRiTable({
    liuRi,
    selectedDate,
    onSelect,
}: {
    liuRi: LiuRiInfo[];
    selectedDate: string;
    onSelect: (date: string) => void;
}) {
    return (
        <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-hide sm:mx-0 sm:px-0">
            <div className="flex gap-1.5">
                {liuRi.map((ri) => {
                    const isSelected = ri.date === selectedDate;
                    const [, month, day] = ri.date.split('-');

                    return (
                        <button
                            key={ri.date}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => onSelect(ri.date)}
                            className={`flex min-w-[52px] shrink-0 flex-col items-center gap-1 rounded-[10px] px-1 py-2 transition-colors duration-150
                                ${isSelected
                                    ? 'bg-accent-light ring-[1.5px] ring-inset ring-accent'
                                    : 'border-[0.5px] border-border bg-surface hover:bg-background-secondary'
                                }`}
                        >
                            <span className={`text-[11px] leading-none tabular-nums ${isSelected ? 'text-accent-strong' : 'text-foreground-tertiary'}`}>
                                {month}/{day}
                            </span>
                            <span className="font-display text-[15px] leading-[1.3]">
                                <span className={ganZhiTextClass(ri.gan)}>{ri.gan}</span>
                                <span className={ganZhiTextClass(ri.zhi)}>{ri.zhi}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
