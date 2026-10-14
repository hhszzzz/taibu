import type { DaYunInfo } from '@/lib/divination/bazi';
import { ganZhiTextClass } from '@/components/bazi/element-classes';

/**
 * 大运横向卡片条（可横向滚动）。
 * - 选中：陶土描边 + accent-light 底
 * - 当前大运：「当前」标签；未被选中时保留柔和陶土描边提示
 */
export function DaYunTable({
    daYun,
    selectedIndex,
    onSelect,
    currentIndex,
}: {
    daYun: DaYunInfo[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    /** 当前所处大运的下标（用于「当前」标记），缺省不标记 */
    currentIndex?: number;
}) {
    return (
        <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-hide sm:mx-0 sm:px-0">
            <div className="flex gap-2">
                {daYun.map((dy, index) => {
                    const isSelected = selectedIndex === index;
                    const isCurrent = currentIndex === index;
                    const stateClass = isSelected
                        ? 'bg-accent-light ring-[1.5px] ring-inset ring-accent'
                        : isCurrent
                            ? 'bg-accent-light/60 ring-1 ring-inset ring-clay/60 hover:bg-accent-light'
                            : 'border-[0.5px] border-border bg-surface hover:bg-background-secondary';
                    const metaClass = isSelected || isCurrent ? 'text-accent-strong' : 'text-foreground-secondary';

                    return (
                        <button
                            key={index}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => onSelect(index)}
                            className={`flex min-w-[84px] flex-1 shrink-0 flex-col items-center gap-1 rounded-xl px-1.5 py-3 transition-colors duration-150 ${isCurrent ? 'sm:min-w-[116px]' : 'sm:min-w-[96px]'} ${stateClass}`}
                        >
                            <span className={`whitespace-nowrap text-xs ${metaClass}`}>
                                {dy.startAge}岁
                                <span className="hidden sm:inline"> · {dy.startYear}</span>
                                {isCurrent && <span> · 当前</span>}
                            </span>
                            <span className="font-display text-[22px] leading-[1.2]">
                                <span className={ganZhiTextClass(dy.gan)}>{dy.gan}</span>
                                <span className={ganZhiTextClass(dy.zhi)}>{dy.zhi}</span>
                            </span>
                            <span className={`text-xs ${metaClass}`}>{dy.tenGod || ' '}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
