import { ChevronDown } from 'lucide-react';

interface FortuneChartOwnerProps {
    chartName: string;
    /** 切换命盘；缺省时命主姓名只读。 */
    onChartSelect?: () => void;
}

/**
 * 运势卡标题行中的「· 命主」片段（日运 / 月运共用）。
 * 仅桌面端显示；移动端由顶栏菜单「切换命盘」承担。
 */
export function FortuneChartOwner({ chartName, onChartSelect }: FortuneChartOwnerProps) {
    return (
        <span className="hidden items-center gap-x-1 lg:inline-flex">
            <span aria-hidden="true">·</span>
            {onChartSelect ? (
                <button
                    type="button"
                    onClick={onChartSelect}
                    aria-label={`切换命盘，当前 ${chartName}`}
                    className="inline-flex max-w-[9rem] items-center gap-0.5 rounded transition-colors hover:text-foreground"
                >
                    <span className="truncate">{chartName}</span>
                    <ChevronDown className="size-3 shrink-0" />
                </button>
            ) : (
                <span className="max-w-[9rem] truncate">{chartName}</span>
            )}
        </span>
    );
}
