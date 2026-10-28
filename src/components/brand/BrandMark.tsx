/**
 * 太卜品牌符号（太卜合契 · Bauhaus TB）。
 *
 * 结构路径取自品牌母版 `design/logo/kit/masters/taibu-symbol.svg`（已转曲，18 个锚点）：
 * 左上扇形 + 中央圭表立柱 + 右上半圆构成 T，中柱 + 右侧双半圆构成 B；
 * 左下星点对应「太 / 卜」的点笔。结构用 currentColor 跟随主题，星点默认取品牌暖陶色。
 */
const STRUCTURE =
    'M33 32H97V96A64 64 0 0 1 33 32Z' +
    'M113 32H163V224A50 50 0 0 1 113 174Z' +
    'M179 32A44 44 0 0 1 179 120Z' +
    'M179 136A44 44 0 0 1 179 224Z';
const ASTRAL_DOT =
    'M65 159.5A32.5 32.5 0 1 1 65 224.5A32.5 32.5 0 1 1 65 159.5Z';

/** ≤ 20px 的小尺寸切版：通道加宽到 22 单位，避免像素化后粘连（对应 favicon.svg）。 */
const STRUCTURE_COMPACT =
    'M19 18H89V88A70 70 0 0 1 19 18Z' +
    'M111 18H167V238A56 56 0 0 1 111 182Z' +
    'M189 18A49 49 0 0 1 189 116Z' +
    'M189 140A49 49 0 0 1 189 238Z';
const ASTRAL_DOT_COMPACT =
    'M54 166A36 36 0 1 1 54 238A36 36 0 1 1 54 166Z';

type BrandMarkProps = {
    className?: string;
    /** 提供时作为有意义的图片；省略则对辅助技术隐藏。 */
    title?: string;
    /** 单色场景（例如压在品牌色底上）星点也跟随 currentColor。 */
    mono?: boolean;
    /** 用于 20px 以下尺寸的加宽通道切版。 */
    compact?: boolean;
};

export function BrandMark({ className, title, mono = false, compact = false }: BrandMarkProps) {
    return (
        <svg
            viewBox="0 0 256 256"
            className={className}
            role={title ? 'img' : undefined}
            aria-label={title}
            aria-hidden={title ? undefined : true}
            focusable="false"
        >
            {title ? <title>{title}</title> : null}
            <path fill="currentColor" d={compact ? STRUCTURE_COMPACT : STRUCTURE} />
            <path fill={mono ? 'currentColor' : 'var(--clay)'} d={compact ? ASTRAL_DOT_COMPACT : ASTRAL_DOT} />
        </svg>
    );
}
