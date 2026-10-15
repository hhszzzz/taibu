import { getFortuneTone } from '@/components/fortune/fortune-display';
import { FORTUNE_DIMENSIONS, fortuneLevelToChartValue, type FortuneLevels } from '@/lib/divination/fortune';

interface FortuneLevelBarsProps {
    levels: FortuneLevels;
    /** 卡片被同行卡片撑高时，等级条均匀铺满剩余高度。 */
    fill?: boolean;
}

/**
 * 五维运势等级条（日运 / 月运共用）。
 * 运势只以等级呈现（fortune.ts 约定不对用户展示数值分），条形长度仅为等级的视觉映射。
 */
export function FortuneLevelBars({ levels, fill = false }: FortuneLevelBarsProps) {
    return (
        <ul className={`flex flex-col gap-3 lg:gap-2.5 ${fill ? 'flex-1 justify-between' : ''}`}>
            {FORTUNE_DIMENSIONS.map((item) => {
                const level = levels[item.key];
                return (
                    <li key={item.key} className="grid grid-cols-[56px_minmax(0,1fr)_28px] items-center gap-2 text-[0.8125rem] lg:gap-3 lg:text-sm">
                        <span className="text-foreground-secondary lg:text-foreground">{item.label}</span>
                        <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-background-secondary">
                            <span
                                className="block h-full rounded-full bg-clay transition-[width] duration-700 ease-out"
                                style={{ width: `${fortuneLevelToChartValue(level)}%` }}
                            />
                        </span>
                        <span className={`text-right ${getFortuneTone(level) === 'unfavorable' ? 'text-danger' : 'text-foreground lg:text-foreground-secondary'}`}>{level}</span>
                    </li>
                );
            })}
        </ul>
    );
}
