/**
 * 奇门九宫格图例：说明宫格各角含义与五行配色
 */
import { Fragment } from 'react';
import { ELEMENT_LEGEND } from './qimen-display';

const LAYOUT_PARTS = ['左上 八神', '右上 宫位', '中 九星 / 八门', '右 天盘干 ⁄ 地盘干'] as const;

/** 窄屏：「·」分隔 + 色块图例；宽屏按设计稿用全角空格分隔，五行以文字颜色示意。 */
export function QimenLegend({ className = '' }: { className?: string }) {
    return (
        <div className={`flex flex-col gap-1 text-[0.6875rem] text-foreground-secondary sm:flex-row sm:flex-wrap sm:gap-x-[22px] sm:gap-y-2 sm:text-xs ${className}`}>
            <span>
                {LAYOUT_PARTS.map((part, index) => (
                    <Fragment key={part}>
                        {index > 0 && <><span className="sm:hidden"> · </span><span className="hidden sm:inline">　</span></>}
                        {part}
                    </Fragment>
                ))}
            </span>
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 sm:gap-x-1">
                <span className="sm:hidden">五行</span>
                <span className="hidden sm:inline">颜色表示五行：</span>
                {ELEMENT_LEGEND.map(item => (
                    <span key={item.label} className={`inline-flex items-center gap-1 ${item.text}`}>
                        <span aria-hidden className={`h-2 w-2 rounded-[2px] sm:hidden ${item.swatch}`} />
                        {item.label}
                    </span>
                ))}
            </span>
        </div>
    );
}
